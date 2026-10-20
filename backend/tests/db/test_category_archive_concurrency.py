"""Archiving a principal category while a subcategory is created or unarchived under it.

Both writers read the principal category first ("is it active?") and then write a subcategory; the
archive writes the principal and then cascades to its subcategories. Without a lock between the
read and the write, a subcategory can end up active under an archived principal. The fix is that
creating or unarchiving a subcategory reads its principal `FOR SHARE`, which conflicts with the
archive's UPDATE of that row (an FK check alone only takes `FOR KEY SHARE`, which does not).

As in `test_first_login_concurrency.py`, the overlap is forced instead of hoped for, on two real
connections (one engine per actor on a scratch database):

1. The first operation writes but does not commit.
2. The second one starts. It has to wait for the first one's row lock.
3. A third connection watches `pg_stat_activity` until it sees a backend waiting on a lock; only
   then does the first operation commit. If the second never blocked, the watcher times out and
   the test fails: it proves the serialisation instead of assuming it.

Whoever goes second sees what the first committed (READ COMMITTED), so the four orders end the
same way: the subcategory is refused, or it is archived with its principal.
"""

import asyncio
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.errors import AppError, ConflictError, InvalidFieldError
from app.modules.categories import service as categories_service
from app.modules.categories.schemas import CategoryCreate
from app.modules.spaces import service as spaces_service
from app.modules.users import service as users_service

BACKEND_DIR = Path(__file__).resolve().parents[2]
TIMEOUT_SECONDS = 20

WAITING_ON_A_LOCK = text(
    "SELECT count(*) FROM pg_stat_activity"
    " WHERE datname = current_database() AND pid <> pg_backend_pid()"
    " AND wait_event_type = 'Lock'"
)

# Principal categories that have a subcategory under an archived principal one. It must stay empty.
ACTIVE_UNDER_ARCHIVED = (
    "SELECT count(*) FROM categories sub JOIN categories main ON main.id = sub.parent_id"
    " WHERE sub.archived_at IS NULL AND main.archived_at IS NOT NULL"
)

Operation = Callable[[AsyncSession], Awaitable[object]]


@dataclass(frozen=True)
class Space:
    id: uuid.UUID
    main_id: uuid.UUID
    sub_id: uuid.UUID  # a subcategory archived on its own, to unarchive in the unarchive scenarios


@pytest.fixture
async def engines(scratch_database_url: str) -> AsyncIterator[tuple[AsyncEngine, ...]]:
    """Three engines on the migrated scratch database: actor A, actor B and the watcher."""
    await asyncio.to_thread(command.upgrade, Config(str(BACKEND_DIR / "alembic.ini")), "head")
    created = tuple(create_async_engine(scratch_database_url) for _ in range(3))
    try:
        yield created
    finally:
        for engine in created:
            await engine.dispose()


async def _committed_space(engine: AsyncEngine) -> Space:
    """A space with an active principal category and an archived subcategory under it."""
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        user = await users_service.upsert_user(
            session, firebase_uid="uid-archive", email="ana@example.com", display_name=None
        )
        await spaces_service.ensure_personal_space(session, user.id, "America/Montevideo")
        space_id = await spaces_service.get_personal_space_id(session, user.id)
        main = await categories_service.create_category(session, space_id, _create("Comida"))
        sub = await categories_service.create_category(
            session, space_id, _create("Supermercado", parent_id=main.id)
        )
        await categories_service.archive_category(session, space_id, sub.id)
        await session.commit()
        return Space(id=space_id, main_id=main.id, sub_id=sub.id)


def _create(name: str, *, parent_id: uuid.UUID | None = None) -> CategoryCreate:
    return CategoryCreate(name=name, kind="expense", icon="fork-knife", parent_id=parent_id)


async def _scalar(engine: AsyncEngine, sql: str, **params: object) -> int:
    async with engine.connect() as conn:
        value: int = (await conn.execute(text(sql), params)).scalar_one()
        return value


async def _overlap(
    engines: tuple[AsyncEngine, ...], first: Operation, second: Operation
) -> tuple[object, object]:
    """Run `first` (it writes, does not commit) and `second` (it has to block on it).

    Returns what each one returned; an `AppError` raised by `second` is returned, not raised.
    """
    engine_a, engine_b, watcher = engines
    first_has_written = asyncio.Event()
    second_is_waiting = asyncio.Event()

    async def run_first() -> object:
        async with async_sessionmaker(engine_a, expire_on_commit=False)() as session:
            result = await first(session)
            first_has_written.set()
            await second_is_waiting.wait()  # the second one is blocked on our row until we commit
            await session.commit()
            return result

    async def run_second() -> object:
        async with async_sessionmaker(engine_b, expire_on_commit=False)() as session:
            await first_has_written.wait()
            try:
                result = await second(session)
            except AppError as error:
                return error  # the session closes without committing
            await session.commit()
            return result

    async def watch_for_the_blocked_one() -> None:
        # AUTOCOMMIT: inside a transaction PostgreSQL caches the pg_stat_activity snapshot, so a
        # polling loop would keep seeing the first answer.
        async with watcher.connect() as raw:
            conn = await raw.execution_options(isolation_level="AUTOCOMMIT")
            # Polling a database condition (there is no event to await), bounded by the timeout.
            while (await conn.execute(WAITING_ON_A_LOCK)).scalar_one() == 0:  # noqa: ASYNC110
                await asyncio.sleep(0.01)
        second_is_waiting.set()

    async with asyncio.timeout(TIMEOUT_SECONDS):
        async with asyncio.TaskGroup() as group:
            task_first = group.create_task(run_first())
            task_second = group.create_task(run_second())
            group.create_task(watch_for_the_blocked_one())
    return task_first.result(), task_second.result()


def _archive(space: Space) -> Operation:
    async def operation(session: AsyncSession) -> object:
        return await categories_service.archive_category(session, space.id, space.main_id)

    return operation


def _create_a_subcategory(space: Space) -> Operation:
    async def operation(session: AsyncSession) -> object:
        data = _create("Restaurantes", parent_id=space.main_id)
        return await categories_service.create_category(session, space.id, data)

    return operation


def _unarchive_the_subcategory(space: Space) -> Operation:
    async def operation(session: AsyncSession) -> object:
        return await categories_service.unarchive_category(session, space.id, space.sub_id)

    return operation


async def _archived_at(engine: AsyncEngine, category_id: uuid.UUID) -> object:
    async with engine.connect() as conn:
        sql = text("SELECT archived_at FROM categories WHERE id = :id")
        return (await conn.execute(sql, {"id": category_id})).scalar_one()


async def test_creating_a_subcategory_while_its_principal_is_being_archived_is_refused(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    space = await _committed_space(engine)

    archived, created = await _overlap(engines, _archive(space), _create_a_subcategory(space))

    assert getattr(archived, "archived_at", None) is not None
    assert isinstance(created, InvalidFieldError)
    assert (created.code, created.loc) == ("category_parent_archived", ["body", "parent_id"])
    assert await _scalar(engine, "SELECT count(*) FROM categories WHERE name = 'Restaurantes'") == 0
    assert await _scalar(engine, ACTIVE_UNDER_ARCHIVED) == 0


async def test_archiving_a_principal_while_a_subcategory_is_being_created_archives_it_too(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    space = await _committed_space(engine)

    created, archived = await _overlap(engines, _create_a_subcategory(space), _archive(space))

    new_id = getattr(created, "id", None)
    assert isinstance(new_id, uuid.UUID)
    main_archived_at = await _archived_at(engine, space.main_id)
    assert main_archived_at is not None
    assert getattr(archived, "archived_at", None) == main_archived_at
    # The archive waited for the new subcategory, so its cascade saw it and archived it with the
    # principal: the same moment.
    assert await _archived_at(engine, new_id) == main_archived_at
    assert await _scalar(engine, ACTIVE_UNDER_ARCHIVED) == 0


async def test_unarchiving_a_subcategory_while_its_principal_is_being_archived_is_refused(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    space = await _committed_space(engine)
    sub_archived_at = await _archived_at(engine, space.sub_id)

    archived, unarchived = await _overlap(
        engines, _archive(space), _unarchive_the_subcategory(space)
    )

    assert getattr(archived, "archived_at", None) is not None
    assert isinstance(unarchived, ConflictError)
    assert unarchived.code == "category_parent_archived"
    # It stays archived, and keeps the moment it was archived on its own.
    assert await _archived_at(engine, space.sub_id) == sub_archived_at
    assert await _scalar(engine, ACTIVE_UNDER_ARCHIVED) == 0


async def test_archiving_a_principal_while_a_subcategory_is_being_unarchived_archives_it_again(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    space = await _committed_space(engine)

    unarchived, archived = await _overlap(
        engines, _unarchive_the_subcategory(space), _archive(space)
    )

    assert getattr(unarchived, "id", None) == space.sub_id
    main_archived_at = await _archived_at(engine, space.main_id)
    assert main_archived_at is not None
    assert getattr(archived, "archived_at", None) == main_archived_at
    # The archive waited for the unarchive, so its cascade found the subcategory active again.
    assert await _archived_at(engine, space.sub_id) == main_archived_at
    assert await _scalar(engine, ACTIVE_UNDER_ARCHIVED) == 0

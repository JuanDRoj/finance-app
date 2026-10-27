"""Two creations with the same `Idempotency-Key` at the same time, on two real connections.

`create_movement` claims the key first with `INSERT ... ON CONFLICT DO UPDATE ... WHERE expired`
and only then creates the movement. Two requests with the same key therefore meet at that INSERT:
the second one has to wait for the transaction of the first and, in READ COMMITTED, goes on
knowing what the first one did. If the first one commits, the key is taken and the second one
answers with the first movement (or with a 409 if its body differs); if it rolls back, the key never
existed and the second one creates its own movement.

As in `test_account_reconcile_concurrency.py` the overlap is forced instead of hoped for
(`tests/overlap.py`): the first operation writes but does not end, the second has to block on it,
and only when a third connection sees a backend waiting on a lock does the first one end. If the
second never blocks (no lock between them) the helper times out and the test fails. The controls at
the end show that different keys, or the same key of another user, do not wait for each other.
"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.modules.spaces.models import SpaceMember
from app.modules.transactions import service as transactions_service
from app.modules.transactions.schemas import MovementCreate
from app.modules.users import service as users_service
from tests.overlap import Operation, overlap
from tests.transactions_helpers import make_account, make_category, make_user_and_space

BACKEND_DIR = Path(__file__).resolve().parents[2]
TIMEOUT_SECONDS = 20
NOW = datetime(2026, 10, 27, 12, 0, tzinfo=UTC)
KEY = uuid.UUID("0199a000-0000-4000-8000-00000000000a")
OTHER_KEY = uuid.UUID("0199a000-0000-4000-8000-00000000000b")
adapter: TypeAdapter[Any] = TypeAdapter(MovementCreate)


@dataclass(frozen=True)
class World:
    user_id: uuid.UUID
    other_user_id: uuid.UUID  # another member of the same space
    space_id: uuid.UUID
    account_id: uuid.UUID
    category_id: uuid.UUID

    def expense(self, amount_minor: int = 1550) -> MovementCreate:
        body: MovementCreate = adapter.validate_python(
            {
                "type": "expense",
                "date": "2026-10-20",
                "account_id": self.account_id,
                "category_id": self.category_id,
                "amount_minor": amount_minor,
            }
        )
        return body


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


async def _committed_world(engine: AsyncEngine) -> World:
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        user_id, space_id = await make_user_and_space(session, "uid-idempotency")
        other = await users_service.upsert_user(
            session, firebase_uid="uid-other", email="other@example.com", display_name=None
        )
        session.add(SpaceMember(user_id=other.id, space_id=space_id, role="member"))
        account = await make_account(session, space_id)
        category = await make_category(session, space_id)
        await session.commit()
        return World(user_id, other.id, space_id, account.id, category.id)


async def _scalar(engine: AsyncEngine, sql: str, **params: object) -> object:
    async with engine.connect() as conn:
        return (await conn.execute(text(sql), params)).scalar_one()


def _create(
    world: World, key: uuid.UUID, data: MovementCreate, *, user_id: uuid.UUID | None = None
) -> Operation:
    async def operation(session: AsyncSession) -> object:
        return await transactions_service.create_movement(
            session,
            world.space_id,
            user_id or world.user_id,
            data,
            idempotency_key=key,
            now=NOW,
        )

    return operation


async def _movements(engine: AsyncEngine) -> object:
    return await _scalar(engine, "SELECT count(*) FROM transactions")


async def _entries(engine: AsyncEngine) -> object:
    return await _scalar(engine, "SELECT count(*) FROM entries")


async def _keys(engine: AsyncEngine) -> object:
    return await _scalar(engine, "SELECT count(*) FROM idempotency_keys")


async def _balance(engine: AsyncEngine, world: World) -> object:
    return await _scalar(
        engine,
        "SELECT coalesce(sum(amount_minor), 0) FROM entries WHERE account_id = :id",
        id=world.account_id,
    )


async def test_two_creations_with_the_same_key_leave_one_movement_and_both_answer_it(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine)

    first, second = await overlap(
        engines, _create(world, KEY, world.expense()), _create(world, KEY, world.expense())
    )

    # The second one waited for the key, found it taken and answered with the first movement.
    assert getattr(first, "id", None) is not None
    assert second == first
    assert await _movements(engine) == 1
    assert await _entries(engine) == 1
    assert await _keys(engine) == 1
    assert await _balance(engine, world) == -1550  # the balance changed once
    # Every committed key is tied to its movement (NULL only exists inside the claiming request).
    assert (
        await _scalar(engine, "SELECT count(*) FROM idempotency_keys WHERE transaction_id IS NULL")
        == 0
    )
    assert await _scalar(engine, "SELECT transaction_id FROM idempotency_keys") == getattr(
        first, "id", None
    )


async def test_the_same_key_with_another_body_waits_and_then_gets_the_409(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine)

    first, second = await overlap(
        engines,
        _create(world, KEY, world.expense(1550)),
        _create(world, KEY, world.expense(2000)),
    )

    assert getattr(first, "id", None) is not None
    assert getattr(second, "code", None) == "idempotency_key_reused"
    assert getattr(second, "status_code", None) == 409
    assert await _movements(engine) == 1
    assert await _keys(engine) == 1
    assert await _balance(engine, world) == -1550


async def test_when_the_first_creation_rolls_back_the_key_never_existed_and_the_second_creates(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine)

    first, second = await overlap(
        engines,
        _create(world, KEY, world.expense(1550)),
        _create(world, KEY, world.expense(2000)),
        first_commits=False,
    )

    assert getattr(first, "id", None) is not None  # it wrote, then rolled back
    assert getattr(second, "id", None) is not None
    assert getattr(second, "id", None) != getattr(first, "id", None)
    # Nothing of the first one survived, not even a 409 for the second body: only its movement.
    assert await _movements(engine) == 1
    assert await _keys(engine) == 1
    assert await _balance(engine, world) == -2000
    assert await _scalar(engine, "SELECT transaction_id FROM idempotency_keys") == getattr(
        second, "id", None
    )


# controls: what must not wait --------------------------------------------------------------------


async def _runs_while_the_other_is_in_flight(
    engines: tuple[AsyncEngine, ...], first: Operation, second: Operation
) -> tuple[object, object]:
    """`second` finishes (and commits) while `first` is still open: no one waits for the other."""
    engine_a, engine_b, _ = engines
    async with async_sessionmaker(engine_a, expire_on_commit=False)() as open_session:
        in_flight = await first(open_session)
        async with async_sessionmaker(engine_b, expire_on_commit=False)() as other_session:
            done = await asyncio.wait_for(second(other_session), TIMEOUT_SECONDS)
            await other_session.commit()
        await open_session.commit()
    return in_flight, done


async def test_different_keys_do_not_wait_for_each_other(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine)

    first, second = await _runs_while_the_other_is_in_flight(
        engines, _create(world, KEY, world.expense()), _create(world, OTHER_KEY, world.expense())
    )

    assert getattr(first, "id", None) != getattr(second, "id", None)
    assert await _movements(engine) == 2
    assert await _keys(engine) == 2
    assert await _balance(engine, world) == -3100


async def test_the_same_key_of_another_member_does_not_wait_and_is_another_movement(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine = engines[0]
    world = await _committed_world(engine)

    mine, theirs = await _runs_while_the_other_is_in_flight(
        engines,
        _create(world, KEY, world.expense()),
        _create(world, KEY, world.expense(), user_id=world.other_user_id),
    )

    assert getattr(mine, "id", None) != getattr(theirs, "id", None)
    assert await _movements(engine) == 2
    assert await _keys(engine) == 2

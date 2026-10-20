"""Two seeds of the same space at the same time, on two real connections.

The login flow already guarantees a single seed per space (only the request that created the
space seeds it), so this test calls the service directly to prove that `seed_default_categories`
is idempotent by itself. As in `test_first_login_concurrency.py`, the overlap is forced instead of
hoped for:

1. Seed A writes the 34 categories but does not commit.
2. Seed B starts. It does not see A's rows (they are not committed), so its guard passes and its
   `INSERT ... ON CONFLICT DO NOTHING` of the main categories has to wait for A's unique index
   entries.
3. A third connection watches `pg_stat_activity` until it sees a backend waiting on a lock; only
   then A commits. B then finds every main already there, inserts nothing and returns False.
"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from app.modules.categories import service as categories_service
from app.modules.spaces import service as spaces_service
from app.modules.users import service as users_service

BACKEND_DIR = Path(__file__).resolve().parents[2]
TIMEOUT_SECONDS = 20

WAITING_ON_A_LOCK = text(
    "SELECT count(*) FROM pg_stat_activity"
    " WHERE datname = current_database() AND pid <> pg_backend_pid()"
    " AND wait_event_type = 'Lock'"
)


@pytest.fixture
async def engines(scratch_database_url: str) -> AsyncIterator[tuple[AsyncEngine, ...]]:
    """Three engines on the migrated scratch database: seed A, seed B and the watcher."""
    await asyncio.to_thread(command.upgrade, Config(str(BACKEND_DIR / "alembic.ini")), "head")
    created = tuple(create_async_engine(scratch_database_url) for _ in range(3))
    try:
        yield created
    finally:
        for engine in created:
            await engine.dispose()


async def _scalar(engine: AsyncEngine, sql: str) -> int:
    async with engine.connect() as conn:
        value: int = (await conn.execute(text(sql))).scalar_one()
        return value


async def _committed_space(engine: AsyncEngine) -> uuid.UUID:
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        user = await users_service.upsert_user(
            session, firebase_uid="uid-seed", email="ana@example.com", display_name=None
        )
        await spaces_service.ensure_personal_space(session, user.id, "America/Montevideo")
        space_id = await spaces_service.get_personal_space_id(session, user.id)
        await session.commit()
        return space_id


async def test_two_simultaneous_seeds_of_one_space_leave_one_valid_set(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine_a, engine_b, watcher = engines
    space_id = await _committed_space(engine_a)
    a_has_written = asyncio.Event()
    b_is_waiting = asyncio.Event()

    async def seed(engine: AsyncEngine, *, is_a: bool) -> bool:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            if not is_a:
                await a_has_written.wait()
            seeded = await categories_service.seed_default_categories(session, space_id)
            if is_a:
                a_has_written.set()
                await b_is_waiting.wait()  # B is blocked on A's rows until we commit
            await session.commit()
            return seeded

    async def watch_for_the_blocked_seed() -> None:
        # AUTOCOMMIT: inside a transaction PostgreSQL caches the pg_stat_activity snapshot, so a
        # polling loop would keep seeing the first answer.
        async with watcher.connect() as raw:
            conn = await raw.execution_options(isolation_level="AUTOCOMMIT")
            # Polling a database condition (there is no event to await), bounded by the timeout.
            while (await conn.execute(WAITING_ON_A_LOCK)).scalar_one() == 0:  # noqa: ASYNC110
                await asyncio.sleep(0.01)
        b_is_waiting.set()

    async with asyncio.timeout(TIMEOUT_SECONDS):
        async with asyncio.TaskGroup() as group:
            seed_a = group.create_task(seed(engine_a, is_a=True))
            seed_b = group.create_task(seed(engine_b, is_a=False))
            group.create_task(watch_for_the_blocked_seed())

    # Exactly one of them wrote the categories; the other found them and wrote nothing.
    assert (seed_a.result(), seed_b.result()) == (True, False)
    assert await _scalar(engine_a, "SELECT count(*) FROM categories") == 34
    assert await _scalar(engine_a, "SELECT count(*) FROM categories WHERE parent_id IS NULL") == 15
    assert (
        await _scalar(
            engine_a,
            "SELECT count(*) FROM categories sub JOIN categories main ON main.id = sub.parent_id "
            "WHERE main.space_id = sub.space_id AND main.kind = sub.kind",
        )
        == 19
    )

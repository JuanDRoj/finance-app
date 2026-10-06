"""Two first logins of the same Firebase user at the same time, on two real connections.

The savepoint fixtures share one connection, so they cannot show a race. Here each login has its
own engine and transaction on a scratch database, and the overlap is forced instead of hoped for:

1. Login A writes the user and the personal space but does not commit.
2. Login B starts. Its `INSERT ... ON CONFLICT` on the same `firebase_uid` has to wait for A's
   uncommitted row.
3. A third connection watches `pg_stat_activity` until it sees a backend waiting on a lock; only
   then A commits. If B never blocked, the watcher times out and the test fails: it proves the
   serialisation instead of assuming it.
"""

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from app.modules.spaces import service as spaces_service
from app.modules.users import service as users_service

BACKEND_DIR = Path(__file__).resolve().parents[2]
FIREBASE_UID = "uid-concurrent"
TIMEOUT_SECONDS = 20

WAITING_ON_A_LOCK = text(
    "SELECT count(*) FROM pg_stat_activity"
    " WHERE datname = current_database() AND pid <> pg_backend_pid()"
    " AND wait_event_type = 'Lock'"
)


@pytest.fixture
async def engines(scratch_database_url: str) -> AsyncIterator[tuple[AsyncEngine, ...]]:
    """Three engines on the migrated scratch database: login A, login B and the watcher."""
    await asyncio.to_thread(command.upgrade, Config(str(BACKEND_DIR / "alembic.ini")), "head")
    created = tuple(create_async_engine(scratch_database_url) for _ in range(3))
    try:
        yield created
    finally:
        for engine in created:
            await engine.dispose()


async def _count(engine: AsyncEngine, sql: str) -> int:
    async with engine.connect() as conn:
        count: int = (await conn.execute(text(sql))).scalar_one()
        return count


async def test_two_simultaneous_first_logins_leave_one_user_one_space_one_owner(
    engines: tuple[AsyncEngine, ...],
) -> None:
    engine_a, engine_b, watcher = engines
    a_has_written = asyncio.Event()
    b_is_waiting = asyncio.Event()

    async def first_login(engine: AsyncEngine, *, is_a: bool) -> bool:
        # The same calls the router makes, with its own session and transaction.
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            if not is_a:
                await a_has_written.wait()
            user = await users_service.upsert_user(
                session, firebase_uid=FIREBASE_UID, email="ana@example.com", display_name="Ana"
            )
            created = await spaces_service.ensure_personal_space(
                session, user.id, "America/Montevideo"
            )
            if is_a:
                a_has_written.set()
                await b_is_waiting.wait()  # B is blocked on A's row until we commit
            await session.commit()
            return created

    async def watch_for_the_blocked_login() -> None:
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
            login_a = group.create_task(first_login(engine_a, is_a=True))
            login_b = group.create_task(first_login(engine_b, is_a=False))
            group.create_task(watch_for_the_blocked_login())

    # Exactly one of them created the space; the other found it.
    assert (login_a.result(), login_b.result()) == (True, False)
    assert await _count(engine_a, "SELECT count(*) FROM users") == 1
    assert await _count(engine_a, "SELECT count(*) FROM spaces WHERE type = 'personal'") == 1
    assert await _count(engine_a, "SELECT count(*) FROM space_members WHERE role = 'owner'") == 1
    assert await _count(engine_a, "SELECT count(*) FROM space_members") == 1

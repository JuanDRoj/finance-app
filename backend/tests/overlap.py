"""Forced overlap of two operations on two real connections (for the tests of `tests/db`).

A race is proved, not hoped for. The first operation writes but does not commit; the second one
starts and has to block on the first one's lock; a third connection watches `pg_stat_activity` until
it sees a backend waiting on a lock, and only then does the first operation commit. If the second
never blocked, the watcher times out and the test fails: it shows the serialisation instead of
assuming it. Whoever goes second sees what the first one committed (READ COMMITTED).

Used by `test_category_archive_concurrency.py`, `test_account_archive_concurrency.py` and
`test_account_reconcile_concurrency.py`; `test_first_login_concurrency.py` follows the same pattern.
"""

import asyncio
from collections.abc import Awaitable, Callable

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.errors import AppError

TIMEOUT_SECONDS = 20

WAITING_ON_A_LOCK = text(
    "SELECT count(*) FROM pg_stat_activity"
    " WHERE datname = current_database() AND pid <> pg_backend_pid()"
    " AND wait_event_type = 'Lock'"
)

Operation = Callable[[AsyncSession], Awaitable[object]]


async def overlap(
    engines: tuple[AsyncEngine, ...], first: Operation, second: Operation
) -> tuple[object, object]:
    """Run `first` (it writes, does not commit) and `second` (it has to block on it).

    `engines` is `(actor A, actor B, watcher)`. Returns what each one returned; an `AppError`
    raised by `second` is returned, not raised (its session closes without committing).
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

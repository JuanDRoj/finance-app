from collections.abc import Callable

import pytest
from sqlalchemy import text
from sqlalchemy.exc import TimeoutError as PoolTimeoutError
from sqlalchemy.pool import QueuePool

from app.core.config import Settings
from app.core.db import Database


def _pool(db: Database) -> QueuePool:
    pool = db.engine.pool
    assert isinstance(pool, QueuePool)
    return pool


async def test_session_runs_queries_over_the_direct_url(database: Database) -> None:
    async with database.sessionmaker() as session:
        assert (await session.execute(text("SELECT 1"))).scalar_one() == 1


async def test_pool_uses_the_default_size_from_settings(database: Database) -> None:
    assert _pool(database).size() == 2


async def test_pool_size_is_configured_by_environment(
    settings_factory: Callable[..., Settings],
) -> None:
    db = await Database.create(settings_factory(DB_POOL_SIZE="4"))
    try:
        assert _pool(db).size() == 4
    finally:
        await db.dispose()


async def test_connections_beyond_pool_size_plus_overflow_time_out(
    settings_factory: Callable[..., Settings],
) -> None:
    db = await Database.create(
        settings_factory(DB_POOL_SIZE="1", DB_MAX_OVERFLOW="1", DB_POOL_TIMEOUT="1")
    )
    try:
        async with db.engine.connect(), db.engine.connect():  # pool(1) + overflow(1)
            with pytest.raises(PoolTimeoutError):
                async with db.engine.connect():
                    pass
    finally:
        await db.dispose()


async def test_migration_engine_does_not_pool_connections(
    settings_factory: Callable[..., Settings],
) -> None:
    db = await Database.create(settings_factory(), null_pool=True)
    try:
        assert not isinstance(db.engine.pool, QueuePool)
        async with db.engine.connect() as conn:
            assert (await conn.execute(text("SELECT 1"))).scalar_one() == 1
    finally:
        await db.dispose()


async def test_dispose_is_idempotent(database: Database) -> None:
    assert not database.closed
    await database.dispose()
    await database.dispose()
    assert database.closed

from collections.abc import Callable

import pytest
from fastapi import FastAPI, HTTPException
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.engine import URL
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.pool import QueuePool

from app.core.config import Settings
from app.core.db import Database, DbSession


def _checked_out(db: Database) -> int:
    pool = db.engine.pool
    assert isinstance(pool, QueuePool)
    return pool.checkedout()


@pytest.fixture
def db_app(app: FastAPI, database: Database) -> FastAPI:
    app.state.db = database

    @app.get("/_test/select-one")
    async def select_one(session: DbSession) -> dict[str, int]:
        return {"value": (await session.execute(text("SELECT 1"))).scalar_one()}

    @app.get("/_test/fail")
    async def fail(session: DbSession) -> None:
        await session.execute(text("SELECT 1"))
        raise HTTPException(status_code=409, detail="conflict")

    return app


async def test_request_gets_a_working_session(db_app: FastAPI, client: AsyncClient) -> None:
    response = await client.get("/_test/select-one")
    assert response.status_code == 200
    assert response.json() == {"value": 1}


async def test_session_connection_is_returned_to_the_pool_after_the_request(
    db_app: FastAPI, client: AsyncClient, database: Database
) -> None:
    await client.get("/_test/select-one")
    assert _checked_out(database) == 0


async def test_session_connection_is_returned_to_the_pool_when_the_handler_fails(
    db_app: FastAPI, client: AsyncClient, database: Database
) -> None:
    response = await client.get("/_test/fail")
    assert response.status_code == 409
    assert _checked_out(database) == 0


async def test_each_request_gets_its_own_session(
    db_app: FastAPI, client: AsyncClient, database: Database
) -> None:
    seen: list[AsyncSession] = []  # keep them alive so object identity is meaningful

    @db_app.get("/_test/session-id")
    async def session_id(session: DbSession) -> dict[str, int]:
        seen.append(session)
        return {}

    await client.get("/_test/session-id")
    await client.get("/_test/session-id")
    assert len(seen) == 2
    assert seen[0] is not seen[1]


async def _probe_database(
    app: FastAPI, scratch_database_url: str, settings_factory: Callable[..., Settings]
) -> Database:
    db = await Database.create(settings_factory(database_url=scratch_database_url))
    app.state.db = db
    async with db.engine.begin() as conn:
        await conn.execute(text("CREATE TABLE probe (id integer PRIMARY KEY)"))
    return db


async def _probe_ids(db: Database) -> list[int]:
    async with db.sessionmaker() as session:
        rows = (await session.execute(text("SELECT id FROM probe ORDER BY id"))).scalars().all()
    return list(rows)


async def test_writes_are_committed_when_the_handler_finishes(
    app: FastAPI,
    client: AsyncClient,
    scratch_database_url: str,
    settings_factory: Callable[..., Settings],
) -> None:
    db = await _probe_database(app, scratch_database_url, settings_factory)
    try:

        @app.post("/_test/insert")
        async def insert(session: DbSession) -> None:
            await session.execute(text("INSERT INTO probe VALUES (1)"))

        assert (await client.post("/_test/insert")).status_code == 200
        assert await _probe_ids(db) == [1]
    finally:
        await db.dispose()


async def test_writes_are_rolled_back_when_the_handler_fails(
    app: FastAPI,
    client: AsyncClient,
    scratch_database_url: str,
    settings_factory: Callable[..., Settings],
) -> None:
    db = await _probe_database(app, scratch_database_url, settings_factory)
    try:

        @app.post("/_test/insert-then-fail")
        async def insert_then_fail(session: DbSession) -> None:
            await session.execute(text("INSERT INTO probe VALUES (1)"))
            raise HTTPException(status_code=409, detail="conflict")

        assert (await client.post("/_test/insert-then-fail")).status_code == 409
        assert await _probe_ids(db) == []
    finally:
        await db.dispose()


async def test_lifespan_creates_and_disposes_the_database(
    app: FastAPI,
    monkeypatch: pytest.MonkeyPatch,
    restore_root_logger: None,
    test_database_url: URL,
) -> None:
    monkeypatch.setenv("DATABASE_URL", test_database_url.render_as_string(hide_password=False))
    async with app.router.lifespan_context(app):
        db = app.state.db
        assert isinstance(db, Database)
        async with db.sessionmaker() as session:
            assert (await session.execute(text("SELECT 1"))).scalar_one() == 1
        assert not db.closed
    assert db.closed

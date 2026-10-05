"""`get_session`: one transaction per request, committed before the response is sent."""

from collections.abc import MutableMapping
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncSession,
    async_sessionmaker,
)

from app.core.db import DbSession, get_sessionmaker
from app.core.errors import ConflictError

Scope = MutableMapping[str, Any]


@pytest.fixture
async def probe_table(db_connection: AsyncConnection) -> None:
    await db_connection.execute(text("CREATE TEMP TABLE probe (id integer PRIMARY KEY)"))


async def _ids(conn: AsyncConnection) -> list[int]:
    rows = await conn.execute(text("SELECT id FROM probe ORDER BY id"))
    return list(rows.scalars().all())


@pytest.fixture
def probe_app(app: FastAPI) -> FastAPI:
    @app.post("/_test/insert", status_code=201)
    async def insert(session: DbSession) -> None:
        await session.execute(text("INSERT INTO probe VALUES (1)"))

    @app.post("/_test/insert-then-conflict")
    async def insert_then_conflict(session: DbSession) -> None:
        await session.execute(text("INSERT INTO probe VALUES (2)"))
        raise ConflictError("probe_conflict", "Conflict")

    @app.post("/_test/insert-then-crash")
    async def insert_then_crash(session: DbSession) -> None:
        await session.execute(text("INSERT INTO probe VALUES (3)"))
        raise RuntimeError("boom")

    return app


async def test_request_is_committed_when_the_endpoint_finishes(
    probe_app: FastAPI, api_client: AsyncClient, db_connection: AsyncConnection, probe_table: None
) -> None:
    assert (await api_client.post("/_test/insert")).status_code == 201
    assert await _ids(db_connection) == [1]


async def test_request_is_rolled_back_on_a_domain_error(
    probe_app: FastAPI, api_client: AsyncClient, db_connection: AsyncConnection, probe_table: None
) -> None:
    response = await api_client.post("/_test/insert-then-conflict")
    assert response.status_code == 409
    assert response.json() == {"detail": "Conflict", "code": "probe_conflict"}
    assert await _ids(db_connection) == []


async def test_request_is_rolled_back_on_an_unexpected_error(
    probe_app: FastAPI, api_client: AsyncClient, db_connection: AsyncConnection, probe_table: None
) -> None:
    response = await api_client.post("/_test/insert-then-crash")
    assert response.status_code == 500
    assert response.json()["code"] == "internal_error"
    assert await _ids(db_connection) == []


async def test_a_failed_request_does_not_affect_the_next_one(
    probe_app: FastAPI, api_client: AsyncClient, db_connection: AsyncConnection, probe_table: None
) -> None:
    await api_client.post("/_test/insert-then-conflict")
    assert (await api_client.post("/_test/insert")).status_code == 201
    assert await _ids(db_connection) == [1]


async def test_commit_happens_before_the_response_is_sent(
    probe_app: FastAPI,
    api_client: AsyncClient,
    db_connection: AsyncConnection,
    probe_table: None,
) -> None:
    events: list[str] = []

    class Spy(AsyncSession):
        async def commit(self) -> None:
            events.append("commit")
            await super().commit()

    probe_app.dependency_overrides[get_sessionmaker] = lambda: async_sessionmaker(
        db_connection,
        class_=Spy,
        join_transaction_mode="create_savepoint",
        expire_on_commit=False,
    )

    class RecordResponseStart:
        def __init__(self, inner: Any) -> None:
            self.inner = inner

        async def __call__(self, scope: Scope, receive: Any, send: Any) -> None:
            async def recording_send(message: MutableMapping[str, Any]) -> None:
                if message["type"] == "http.response.start":
                    events.append("response_start")
                await send(message)

            await self.inner(scope, receive, recording_send)

    probe_app.add_middleware(RecordResponseStart)

    assert (await api_client.post("/_test/insert")).status_code == 201
    assert events == ["commit", "response_start"]


async def test_a_failing_commit_is_a_generic_500_without_leaking_details(
    probe_app: FastAPI,
    api_client: AsyncClient,
    db_connection: AsyncConnection,
    probe_table: None,
) -> None:
    class Failing(AsyncSession):
        async def commit(self) -> None:
            raise RuntimeError("INSERT INTO secrets VALUES ('hunter2') failed")

    probe_app.dependency_overrides[get_sessionmaker] = lambda: async_sessionmaker(
        db_connection,
        class_=Failing,
        join_transaction_mode="create_savepoint",
        expire_on_commit=False,
    )

    response = await api_client.post("/_test/insert")
    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error", "code": "internal_error"}
    assert "hunter2" not in response.text
    assert await _ids(db_connection) == []

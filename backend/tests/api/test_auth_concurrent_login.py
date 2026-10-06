"""Two first logins of the same user at the same time, through HTTP, on real connections.

`api_client` shares one connection between requests, so it cannot show a race. Here the app gets
a real pool on a scratch database and the two `POST /auth/session` run with `asyncio.gather`.
The fake Firebase makes both requests wait for each other (a barrier of two) before either one
touches the database, so they enter the transaction together. How PostgreSQL then orders the
two inserts is up to it, and the result must be the same every time: one user, one space, one
owner. The overlap itself is forced at service level in `tests/db/test_first_login_concurrency.py`.
"""

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

from app.core.config import Settings
from app.core.db import Database, get_sessionmaker
from app.modules.auth.dependencies import get_firebase_auth
from app.modules.auth.firebase import FirebaseIdentity
from tests.fakes import FakeFirebaseAuth, make_identity

BACKEND_DIR = Path(__file__).resolve().parents[2]
ORIGIN = "http://localhost:3000"
BODY = {"id_token": "id-token-123", "timezone": "America/Montevideo"}
ROUNDS = 5
TIMEOUT_SECONDS = 30


class RendezvousFirebase(FakeFirebaseAuth):
    """A fake whose `verify_id_token` returns only once both logins have called it."""

    def __init__(self) -> None:
        super().__init__()
        self.barrier = asyncio.Barrier(2)

    async def verify_id_token(self, id_token: str) -> FirebaseIdentity:
        identity = await super().verify_id_token(id_token)
        await self.barrier.wait()
        return identity


@pytest.fixture
async def real_pool_engine(scratch_database_url: str) -> AsyncIterator[AsyncEngine]:
    """The app's own `Database` (a real pool) on a freshly migrated scratch database."""
    await asyncio.to_thread(command.upgrade, Config(str(BACKEND_DIR / "alembic.ini")), "head")
    db = await Database.create(Settings(_env_file=None))
    try:
        yield db.engine
    finally:
        await db.dispose()


@pytest.fixture
async def concurrent_client(
    app: FastAPI, real_pool_engine: AsyncEngine
) -> AsyncIterator[tuple[AsyncClient, RendezvousFirebase, AsyncEngine]]:
    fake = RendezvousFirebase()
    app.dependency_overrides[get_firebase_auth] = lambda: fake
    factory = async_sessionmaker(real_pool_engine, expire_on_commit=False)
    app.dependency_overrides[get_sessionmaker] = lambda: factory
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, fake, real_pool_engine


async def _scalar(engine: AsyncEngine, sql: str) -> int:
    async with engine.connect() as conn:
        value: int = (await conn.execute(text(sql))).scalar_one()
        return value


async def test_parallel_first_logins_through_http_leave_one_space(
    concurrent_client: tuple[AsyncClient, RendezvousFirebase, AsyncEngine],
) -> None:
    client, fake, engine = concurrent_client

    async with asyncio.timeout(TIMEOUT_SECONDS):
        for round_number in range(ROUNDS):
            uid = f"uid-parallel-{round_number}"
            fake.identity = make_identity(uid=uid, email=f"{uid}@example.com")

            first, second = await asyncio.gather(
                client.post("/auth/session", json=BODY, headers={"Origin": ORIGIN}),
                client.post("/auth/session", json=BODY, headers={"Origin": ORIGIN}),
            )

            assert (first.status_code, second.status_code) == (204, 204), (
                first.text,
                second.text,
            )
            created = round_number + 1
            assert await _scalar(engine, "SELECT count(*) FROM users") == created
            assert await _scalar(engine, "SELECT count(*) FROM spaces") == created
            assert (
                await _scalar(engine, "SELECT count(*) FROM space_members WHERE role = 'owner'")
                == created
            )
            assert await _scalar(engine, "SELECT count(*) FROM space_members") == created

    # One personal space per user, the one the product promises: "Mi espacio", UYU.
    assert (
        await _scalar(
            engine,
            "SELECT count(*) FROM spaces WHERE name = 'Mi espacio' AND currency = 'UYU'"
            " AND type = 'personal' AND timezone = 'America/Montevideo'",
        )
        == ROUNDS
    )

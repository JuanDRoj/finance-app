"""Two `POST /spaces/{id}/transactions` with the same `Idempotency-Key` at the same time (KAN-93).

`api_client` shares one connection between requests, so it cannot show a race. Here the app gets a
real pool on a scratch database and the two POST run with `asyncio.gather`. The fake Firebase makes
both requests wait for each other (a barrier of two) before either one touches the database, so
they enter the transaction together. How PostgreSQL then orders them is up to it, and the result
must be the same every time: both answer 201 with the same movement, and only one movement, one set
of entries, one key and one change of the balance exist. The overlap itself is forced at service
level in `tests/db/test_transaction_idempotency_concurrency.py`.
"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

from app.core.config import Settings
from app.core.db import Database, get_sessionmaker
from app.modules.auth.dependencies import get_firebase_auth
from app.modules.auth.firebase import FirebaseIdentity
from tests.fakes import FakeFirebaseAuth, make_identity
from tests.transactions_helpers import make_account, make_category, make_user_and_space

BACKEND_DIR = Path(__file__).resolve().parents[2]
COOKIE = {"Cookie": "session=valid-cookie"}
UID = "uid-concurrent-post"
ROUNDS = 5
TIMEOUT_SECONDS = 60


class RendezvousFirebase(FakeFirebaseAuth):
    """A fake whose `verify_session_cookie` returns only once both requests have called it."""

    def __init__(self) -> None:
        super().__init__()
        self.barrier = asyncio.Barrier(2)

    async def verify_session_cookie(self, cookie: str) -> FirebaseIdentity:
        identity = await super().verify_session_cookie(cookie)
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
) -> AsyncIterator[AsyncClient]:
    fake = RendezvousFirebase()
    fake.session_identity = make_identity(uid=UID)
    app.dependency_overrides[get_firebase_auth] = lambda: fake
    factory = async_sessionmaker(real_pool_engine, expire_on_commit=False)
    app.dependency_overrides[get_sessionmaker] = lambda: factory
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


async def _scalar(engine: AsyncEngine, sql: str) -> int:
    async with engine.connect() as conn:
        value: int = (await conn.execute(text(sql))).scalar_one()
        return value


async def _committed_world(engine: AsyncEngine) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        _, space_id = await make_user_and_space(session, UID)
        account = await make_account(session, space_id)
        category = await make_category(session, space_id)
        await session.commit()
        return space_id, account.id, category.id


async def _post(
    client: AsyncClient, space_id: uuid.UUID, body: dict[str, object], key: str
) -> Response:
    return await client.post(
        f"/spaces/{space_id}/transactions", json=body, headers={**COOKIE, "Idempotency-Key": key}
    )


async def test_two_simultaneous_posts_with_the_same_key_create_one_movement(
    concurrent_client: AsyncClient, real_pool_engine: AsyncEngine
) -> None:
    engine = real_pool_engine
    space_id, account_id, category_id = await _committed_world(engine)
    body: dict[str, object] = {
        "type": "expense",
        "date": "2026-10-20",
        "account_id": str(account_id),
        "category_id": str(category_id),
        "amount_minor": 1550,
    }

    async with asyncio.timeout(TIMEOUT_SECONDS):
        for round_number in range(ROUNDS):
            first, second = await asyncio.gather(
                _post(concurrent_client, space_id, body, str(uuid.uuid4())),
                _post(concurrent_client, space_id, body, str(uuid.uuid4())),
            )
            # Different keys: two movements (the control of the round).
            assert (first.status_code, second.status_code) == (201, 201), (first.text, second.text)
            assert first.json()["id"] != second.json()["id"]

            key = str(uuid.uuid4())
            third, fourth = await asyncio.gather(
                _post(concurrent_client, space_id, body, key),
                _post(concurrent_client, space_id, body, key),
            )

            assert (third.status_code, fourth.status_code) == (201, 201), (third.text, fourth.text)
            assert fourth.json() == third.json()
            assert third.json()["id"] not in (first.json()["id"], second.json()["id"])
            created = (round_number + 1) * 3  # per round: two with different keys and one pair
            assert await _scalar(engine, "SELECT count(*) FROM transactions") == created
            assert await _scalar(engine, "SELECT count(*) FROM entries") == created
            assert await _scalar(engine, "SELECT count(*) FROM idempotency_keys") == created
            assert (
                await _scalar(
                    engine, "SELECT count(*) FROM idempotency_keys WHERE transaction_id IS NULL"
                )
                == 0
            )
            assert await _scalar(engine, "SELECT sum(amount_minor) FROM entries") == -1550 * created

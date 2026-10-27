"""The default categories are created once, however many first logins arrive together.

`test_auth_concurrent_login.py` runs two simultaneous logins and counts rows in SQL, and
`tests/db/test_first_login_concurrency.py` / `test_seed_categories_concurrency.py` force the overlap
of two writers at service level. Here the app gets a real pool on a scratch database (the savepoint
fixtures share one connection and cannot show a race) and **four** logins enter together:

- `rendezvous`: the fake Firebase makes each `POST /auth/session` wait for the others (a barrier)
  after verifying its token and before it touches the database, so all of them open their
  transaction at the same moment, with no `sleep`. How PostgreSQL then orders the writes is up to
  it, and the result must be the same under any order.
- The result is read back through the public API (`GET /spaces`, `GET .../categories`), not only
  with SQL: one space, 34 categories (15 main, 19 sub), no duplicates, and nothing shared between
  the spaces of different users.

Four is the most the pool allows (2 + 3 overflow = 5 connections, one per request).
"""

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

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

BACKEND_DIR = Path(__file__).resolve().parents[2]
ORIGIN = {"Origin": "http://localhost:3000"}
COOKIE = {"Cookie": "session=valid-cookie"}
PARTIES = 4
ROUNDS = 3
TIMEOUT_SECONDS = 30

DEFAULT_CATEGORIES = 34
MAIN_CATEGORIES = 15
SUBCATEGORIES = 19
FIRST_MAIN_NAMES = ["Comida", "Transporte", "Hogar", "Salud", "Ocio"]


class RendezvousFirebase(FakeFirebaseAuth):
    """A fake whose `verify_id_token` returns only once `PARTIES` logins have called it.

    The identity comes from the token (`identities`), so the same fake serves several users. With
    `barrier = None` a login does not wait (the sequential logins of a test).
    """

    def __init__(self) -> None:
        super().__init__()
        self.identities: dict[str, FirebaseIdentity] = {}
        self.barrier: asyncio.Barrier | None = None

    def add_user(self, uid: str) -> str:
        """Register a Firebase user and return the ID token that logs in as them."""
        token = f"id-token-{uid}"
        self.identities[token] = make_identity(uid=uid, email=f"{uid}@example.com")
        return token

    def sign_in_as(self, uid: str) -> None:
        """The session cookie of the next requests belongs to this user."""
        self.session_identity = self.identities[f"id-token-{uid}"]

    async def verify_id_token(self, id_token: str) -> FirebaseIdentity:
        identity = self.identities[id_token]
        self.verified_tokens.append(id_token)
        if self.barrier is not None:
            await self.barrier.wait()
        return identity


@pytest.fixture
async def engine(scratch_database_url: str) -> AsyncIterator[AsyncEngine]:
    """The app's own `Database` (a real pool) on a freshly migrated scratch database."""
    await asyncio.to_thread(command.upgrade, Config(str(BACKEND_DIR / "alembic.ini")), "head")
    db = await Database.create(Settings(_env_file=None))
    try:
        yield db.engine
    finally:
        await db.dispose()


@pytest.fixture
async def rendezvous(app: FastAPI, engine: AsyncEngine) -> RendezvousFirebase:
    fake = RendezvousFirebase()
    app.dependency_overrides[get_firebase_auth] = lambda: fake
    factory = async_sessionmaker(engine, expire_on_commit=False)
    app.dependency_overrides[get_sessionmaker] = lambda: factory
    return fake


@pytest.fixture
async def concurrent_client(
    app: FastAPI, rendezvous: RendezvousFirebase
) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


async def _login(client: AsyncClient, token: str) -> Response:
    return await client.post(
        "/auth/session",
        json={"id_token": token, "timezone": "America/Montevideo"},
        headers=ORIGIN,
    )


async def _scalar(engine: AsyncEngine, sql: str) -> int:
    async with engine.connect() as conn:
        value: int = (await conn.execute(text(sql))).scalar_one()
        return value


async def _only_space_id(client: AsyncClient) -> str:
    response = await client.get("/spaces", headers=COOKIE)
    assert response.status_code == 200, response.text
    [space] = response.json()
    space_id: str = space["id"]
    return space_id


async def _categories(client: AsyncClient, space_id: str) -> list[dict[str, Any]]:
    response = await client.get(
        f"/spaces/{space_id}/categories", params={"include_archived": "true"}, headers=COOKIE
    )
    assert response.status_code == 200, response.text
    categories: list[dict[str, Any]] = response.json()
    return categories


def _assert_one_valid_default_set(categories: list[dict[str, Any]]) -> None:
    """Exactly the 34 predefined categories, once: 15 main, 19 sub, none repeated or archived."""
    assert len(categories) == DEFAULT_CATEGORIES
    assert len({c["id"] for c in categories}) == DEFAULT_CATEGORIES
    mains = [c for c in categories if c["parent_id"] is None]
    subs = [c for c in categories if c["parent_id"] is not None]
    assert (len(mains), len(subs)) == (MAIN_CATEGORIES, SUBCATEGORIES)
    assert [c["name"] for c in mains][:5] == FIRST_MAIN_NAMES
    assert len({(c["kind"], c["name"]) for c in mains}) == MAIN_CATEGORIES
    assert len({(c["parent_id"], c["name"]) for c in subs}) == SUBCATEGORIES
    main_ids = {c["id"] for c in mains}
    assert {c["parent_id"] for c in subs} <= main_ids  # every sub hangs from a main of this set
    assert all(c["archived_at"] is None for c in categories)


async def test_four_simultaneous_first_logins_of_one_user_leave_one_set_of_default_categories(
    concurrent_client: AsyncClient, rendezvous: RendezvousFirebase, engine: AsyncEngine
) -> None:
    async with asyncio.timeout(TIMEOUT_SECONDS):
        for round_number in range(ROUNDS):
            uid = f"uid-qa-same-{round_number}"
            token = rendezvous.add_user(uid)
            rendezvous.barrier = asyncio.Barrier(PARTIES)

            responses = await asyncio.gather(
                *(_login(concurrent_client, token) for _ in range(PARTIES))
            )

            assert [r.status_code for r in responses] == [204] * PARTIES, [
                r.text for r in responses
            ]
            rendezvous.sign_in_as(uid)
            space_id = await _only_space_id(concurrent_client)
            _assert_one_valid_default_set(await _categories(concurrent_client, space_id))

        # A later login of an existing user changes nothing.
        rendezvous.barrier = None
        again = await _login(concurrent_client, token)
        assert again.status_code == 204
        _assert_one_valid_default_set(await _categories(concurrent_client, space_id))

    # Across the rounds: one user, one space, one owner and one set of categories each.
    assert await _scalar(engine, "SELECT count(*) FROM users") == ROUNDS
    assert await _scalar(engine, "SELECT count(*) FROM spaces") == ROUNDS
    assert (
        await _scalar(engine, "SELECT count(*) FROM space_members WHERE role = 'owner'") == ROUNDS
    )
    assert await _scalar(engine, "SELECT count(*) FROM space_members") == ROUNDS
    assert await _scalar(engine, "SELECT count(*) FROM categories") == ROUNDS * DEFAULT_CATEGORIES


async def test_simultaneous_first_logins_of_different_users_each_get_their_own_set(
    concurrent_client: AsyncClient, rendezvous: RendezvousFirebase, engine: AsyncEngine
) -> None:
    uids = [f"uid-qa-user-{n}" for n in range(PARTIES)]
    tokens = [rendezvous.add_user(uid) for uid in uids]
    rendezvous.barrier = asyncio.Barrier(PARTIES)

    async with asyncio.timeout(TIMEOUT_SECONDS):
        responses = await asyncio.gather(*(_login(concurrent_client, token) for token in tokens))

    assert [r.status_code for r in responses] == [204] * PARTIES, [r.text for r in responses]
    assert await _scalar(engine, "SELECT count(*) FROM users") == PARTIES
    assert await _scalar(engine, "SELECT count(*) FROM spaces") == PARTIES
    assert await _scalar(engine, "SELECT count(*) FROM categories") == PARTIES * DEFAULT_CATEGORIES
    space_ids: dict[str, str] = {}
    category_ids: set[str] = set()
    for uid in uids:
        rendezvous.sign_in_as(uid)
        space_ids[uid] = await _only_space_id(concurrent_client)
        categories = await _categories(concurrent_client, space_ids[uid])
        _assert_one_valid_default_set(categories)
        category_ids |= {c["id"] for c in categories}
    # No category is shared between spaces, and no user reaches the space of another.
    assert len(set(space_ids.values())) == PARTIES
    assert len(category_ids) == PARTIES * DEFAULT_CATEGORIES
    rendezvous.sign_in_as(uids[0])
    foreign = await concurrent_client.get(
        f"/spaces/{space_ids[uids[1]]}/categories", headers=COOKIE
    )
    assert (foreign.status_code, foreign.json()["code"]) == (404, "space_not_found")

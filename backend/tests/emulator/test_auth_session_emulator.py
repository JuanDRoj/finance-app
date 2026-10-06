"""End to end against the real Firebase Auth emulator (`docker compose up -d` from the repo root).

Like PostgreSQL, the emulator is a requirement of the suite: when it is not reachable these tests
fail with instructions instead of being skipped. They use the real firebase-admin adapter, so they
cover what the fake cannot: the emulator's own tokens and its `createSessionCookie`.
"""

import asyncio
import os
import socket
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from firebase_admin import auth
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import LOCAL_FIREBASE_EMULATOR_HOST, Settings
from app.modules.auth.dependencies import get_firebase_auth
from app.modules.auth.firebase import FirebaseAdminAuth, create_firebase_auth
from app.modules.spaces.models import Space
from app.modules.users.models import User
from tests.fakes import parse_set_cookie, unsigned_id_token

ORIGIN = "http://localhost:3000"
FAKE_API_KEY = "fake-api-key"  # the emulator ignores it


@pytest.fixture(scope="session")
def emulator_host() -> str:
    host = os.environ.get("FIREBASE_AUTH_EMULATOR_HOST") or LOCAL_FIREBASE_EMULATOR_HOST
    name, _, port = host.partition(":")
    try:
        socket.create_connection((name, int(port)), timeout=2).close()
    except OSError:
        pytest.fail(
            f"The Firebase Auth emulator is not reachable at {host}. "
            "Start it with `docker compose up -d` from the repo root (see README).",
            pytrace=False,
        )
    return host


@pytest.fixture
def real_firebase(
    app: FastAPI, emulator_host: str, monkeypatch: pytest.MonkeyPatch
) -> Iterator[FirebaseAdminAuth]:
    # Set through monkeypatch so that the variable `create_firebase_auth` writes is undone.
    monkeypatch.setenv("FIREBASE_AUTH_EMULATOR_HOST", emulator_host)
    adapter = create_firebase_auth(Settings(_env_file=None))
    app.dependency_overrides[get_firebase_auth] = lambda: adapter
    try:
        yield adapter
    finally:
        adapter.close()


async def _sign_up(emulator_host: str, email: str, display_name: str) -> str:
    """Create an account in the emulator and return its ID token."""
    url = f"http://{emulator_host}/identitytoolkit.googleapis.com/v1/accounts:signUp"
    async with AsyncClient() as http:
        response = await http.post(
            url,
            params={"key": FAKE_API_KEY},
            json={
                "email": email,
                "password": "correct-horse-battery",
                "displayName": display_name,
                "returnSecureToken": True,
            },
        )
    response.raise_for_status()
    return str(response.json()["idToken"])


async def test_a_real_sign_up_gets_a_session_cookie_that_firebase_accepts(
    api_client: AsyncClient,
    real_firebase: FirebaseAdminAuth,
    emulator_host: str,
    session: AsyncSession,
) -> None:
    email = f"e2e-{uuid.uuid4().hex[:10]}@example.com"
    id_token = await _sign_up(emulator_host, email, "Eva E2E")

    response = await api_client.post(
        "/auth/session",
        json={"id_token": id_token, "timezone": "America/Montevideo"},
        headers={"Origin": ORIGIN},
    )

    assert response.status_code == 204
    name, morsel = parse_set_cookie(response.headers["set-cookie"])
    assert name == "session"
    claims = await asyncio.to_thread(
        auth.verify_session_cookie, morsel.value, app=real_firebase.app
    )
    assert claims["email"] == email

    user = await session.scalar(select(User).where(User.firebase_uid == claims["uid"]))
    assert user is not None
    assert (user.email, user.display_name) == (email, "Eva E2E")
    space = await session.scalar(select(Space).where(Space.created_by == user.id))
    assert space is not None
    assert (space.type, space.currency, space.timezone) == (
        "personal",
        "UYU",
        "America/Montevideo",
    )


async def test_a_token_from_another_project_is_a_401(
    api_client: AsyncClient, real_firebase: FirebaseAdminAuth
) -> None:
    token = unsigned_id_token("demo-another-project")

    response = await api_client.post(
        "/auth/session",
        json={"id_token": token, "timezone": "UTC"},
        headers={"Origin": ORIGIN},
    )

    assert response.status_code == 401
    assert response.json()["code"] == "invalid_id_token"
    assert "set-cookie" not in response.headers


async def test_a_sign_in_older_than_five_minutes_is_a_401_through_the_whole_stack(
    api_client: AsyncClient, real_firebase: FirebaseAdminAuth
) -> None:
    ten_minutes_ago = int((datetime.now(UTC) - timedelta(minutes=10)).timestamp())

    response = await api_client.post(
        "/auth/session",
        json={"id_token": unsigned_id_token(auth_time=ten_minutes_ago), "timezone": "UTC"},
        headers={"Origin": ORIGIN},
    )

    assert response.status_code == 401
    assert response.json()["code"] == "recent_sign_in_required"
    assert "set-cookie" not in response.headers

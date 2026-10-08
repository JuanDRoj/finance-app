"""End to end against the real Firebase Auth emulator (`docker compose up -d` from the repo root).

Like PostgreSQL, the emulator is a requirement of the suite: when it is not reachable these tests
fail with instructions instead of being skipped. They use the real firebase-admin adapter, so they
cover what the fake cannot: the emulator's own tokens and its `createSessionCookie`.
"""

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

from firebase_admin import auth
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.firebase import FirebaseAdminAuth
from app.modules.spaces.models import Space
from app.modules.users.models import User
from tests.emulator.helpers import EmulatorAccount
from tests.fakes import parse_set_cookie, unsigned_id_token

ORIGIN = "http://localhost:3000"
NewUser = Callable[..., Awaitable[EmulatorAccount]]


async def test_a_real_sign_up_gets_a_session_cookie_that_firebase_accepts(
    api_client: AsyncClient,
    real_firebase: FirebaseAdminAuth,
    emulator_user: NewUser,
    session: AsyncSession,
) -> None:
    account = await emulator_user("Eva E2E")
    email = account.email
    id_token = account.id_token

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

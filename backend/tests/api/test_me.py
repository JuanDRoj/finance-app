from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import UnauthenticatedError
from app.modules.users import service as users_service
from tests.fakes import FakeFirebaseAuth, make_identity

COOKIE = {"Cookie": "session=valid-cookie"}


async def test_me_returns_id_email_and_display_name_only(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user = await users_service.upsert_user(
        session, firebase_uid="uid-a", email="a@example.com", display_name="Ana"
    )
    fake_firebase.session_identity = make_identity(uid="uid-a")

    response = await api_client.get("/me", headers=COOKIE)

    assert response.status_code == 200
    assert response.json() == {"id": str(user.id), "email": "a@example.com", "display_name": "Ana"}


async def test_me_returns_null_display_name(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    await users_service.upsert_user(
        session, firebase_uid="uid-a", email="a@example.com", display_name=None
    )
    fake_firebase.session_identity = make_identity(uid="uid-a")

    response = await api_client.get("/me", headers=COOKIE)

    assert response.json()["display_name"] is None


async def test_me_without_cookie_is_401(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth
) -> None:
    response = await api_client.get("/me")

    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated", "code": "not_authenticated"}


async def test_me_with_a_rejected_cookie_is_401(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth
) -> None:
    fake_firebase.session_error = UnauthenticatedError("invalid_session", "Invalid session")

    response = await api_client.get("/me", headers=COOKIE)

    assert response.status_code == 401
    assert response.json()["code"] == "invalid_session"

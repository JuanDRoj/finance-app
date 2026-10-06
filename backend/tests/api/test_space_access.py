"""`current_user` (401) and `require_space_member` (404, never 403), through test-only routes.

No `/spaces/{space_id}/...` route exists yet, so the routes below are mounted in each test. They
use the dependencies exactly as the real routers will: `require_space_member` on the `APIRouter`.
"""

import uuid
from collections.abc import Callable
from uuid import UUID

import pytest
from fastapi import APIRouter, Depends, FastAPI
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.errors import ErrorResponse, UnauthenticatedError
from app.modules.auth.dependencies import CurrentUser
from app.modules.spaces import service as spaces_service
from app.modules.spaces.dependencies import SpaceMember, require_space_member
from app.modules.spaces.models import Space
from app.modules.users import service as users_service
from app.modules.users.schemas import UserRead
from tests.fakes import FakeFirebaseAuth, make_identity

COOKIE = {"Cookie": "session=valid-cookie"}
NOT_AUTHENTICATED = {"detail": "Not authenticated", "code": "not_authenticated"}
INVALID_SESSION = {"detail": "Invalid session", "code": "invalid_session"}
SPACE_NOT_FOUND = {"detail": "Space not found", "code": "space_not_found"}


@pytest.fixture(autouse=True)
def routes(app: FastAPI) -> None:
    router = APIRouter(
        prefix="/spaces/{space_id}/ping",
        dependencies=[Depends(require_space_member)],
        responses={404: {"model": ErrorResponse}},
    )

    @router.get("")
    async def ping_get(space_id: UUID) -> dict[str, str]:
        return {"space_id": str(space_id)}

    @router.post("")
    async def ping_post(space_id: UUID) -> dict[str, str]:
        return {"space_id": str(space_id)}

    @router.get("/role")
    async def ping_role(member: SpaceMember) -> str:
        return member.role

    @app.get("/whoami")
    async def whoami(user: CurrentUser) -> UserRead:
        return user

    app.include_router(router)


async def _user(session: AsyncSession, uid: str) -> UserRead:
    return await users_service.upsert_user(
        session, firebase_uid=uid, email=f"{uid}@example.com", display_name=None
    )


async def _space_of(session: AsyncSession, uid: str) -> tuple[UserRead, UUID]:
    user = await _user(session, uid)
    await spaces_service.ensure_personal_space(session, user.id, "America/Montevideo")
    space_id = await session.scalar(select(Space.id).where(Space.created_by == user.id))
    assert space_id is not None
    return user, space_id


def _sign_in_as(fake: FakeFirebaseAuth, uid: str) -> None:
    fake.session_identity = make_identity(uid=uid)


async def test_current_user_returns_the_user_of_a_valid_session(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user = await _user(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.get("/whoami", headers=COOKIE)

    assert response.status_code == 200
    assert response.json()["id"] == str(user.id)
    assert fake_firebase.verified_cookies == ["valid-cookie"]


async def test_the_staging_cookie_name_is_read_outside_local(
    app: FastAPI,
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    settings_factory: Callable[..., Settings],
) -> None:
    await _user(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    app.dependency_overrides[get_settings] = lambda: settings_factory(
        ENV="staging",
        FIREBASE_PROJECT_ID="finance-staging",
        ALLOWED_ORIGINS="https://a.example.com",
    )

    ok = await api_client.get("/whoami", headers={"Cookie": "__Host-session=valid-cookie"})
    local_name = await api_client.get("/whoami", headers=COOKIE)

    assert ok.status_code == 200
    assert local_name.status_code == 401
    assert local_name.json() == NOT_AUTHENTICATED


async def test_no_cookie_is_a_401_and_firebase_is_not_called(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth
) -> None:
    response = await api_client.get("/whoami")

    assert response.status_code == 401
    assert response.json() == NOT_AUTHENTICATED
    assert not fake_firebase.called


async def test_a_cookie_that_firebase_rejects_is_a_401(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth
) -> None:
    fake_firebase.session_error = UnauthenticatedError("invalid_session", "Invalid session")

    response = await api_client.get("/whoami", headers=COOKIE)

    assert response.status_code == 401
    assert response.json() == INVALID_SESSION


async def test_a_valid_cookie_without_a_user_row_is_a_401(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth
) -> None:
    _sign_in_as(fake_firebase, "uid-never-logged-in")

    response = await api_client.get("/whoami", headers=COOKIE)

    assert response.status_code == 401
    assert response.json() == INVALID_SESSION


async def test_an_unexpected_firebase_failure_is_the_generic_500(
    app: FastAPI, api_client: AsyncClient, fake_firebase: FakeFirebaseAuth
) -> None:
    fake_firebase.session_error = RuntimeError("google unreachable")

    response = await api_client.get("/whoami", headers=COOKIE)

    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error", "code": "internal_error"}


async def test_a_member_reaches_their_space(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await _space_of(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    get = await api_client.get(f"/spaces/{space_id}/ping", headers=COOKIE)
    post = await api_client.post(f"/spaces/{space_id}/ping", headers=COOKIE)
    role = await api_client.get(f"/spaces/{space_id}/ping/role", headers=COOKIE)

    assert get.status_code == 200
    assert get.json() == {"space_id": str(space_id)}
    assert post.status_code == 200
    assert role.json() == "owner"


async def test_user_b_gets_404_on_the_space_of_user_a(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_a = await _space_of(session, "uid-a")
    await _space_of(session, "uid-b")
    _sign_in_as(fake_firebase, "uid-b")

    for method in ("get", "post"):
        response = await getattr(api_client, method)(f"/spaces/{space_a}/ping", headers=COOKIE)
        assert response.status_code == 404, method
        assert response.json() == SPACE_NOT_FOUND


async def test_a_space_that_does_not_exist_is_the_same_404_as_one_of_someone_else(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_a = await _space_of(session, "uid-a")
    await _space_of(session, "uid-b")
    _sign_in_as(fake_firebase, "uid-b")

    foreign = await api_client.get(f"/spaces/{space_a}/ping", headers=COOKIE)
    missing = await api_client.get(f"/spaces/{uuid.uuid4()}/ping", headers=COOKIE)

    assert (foreign.status_code, foreign.json()) == (missing.status_code, missing.json())
    assert foreign.status_code == 404


async def test_without_a_session_a_space_route_is_a_401_before_any_404(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_a = await _space_of(session, "uid-a")

    response = await api_client.get(f"/spaces/{space_a}/ping")

    assert response.status_code == 401
    assert response.json() == NOT_AUTHENTICATED


async def test_a_space_id_that_is_not_a_uuid_is_a_422(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    await _user(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.get("/spaces/not-a-uuid/ping", headers=COOKIE)

    assert response.status_code == 422

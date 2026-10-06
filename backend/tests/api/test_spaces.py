import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import UnauthenticatedError
from app.modules.spaces import service as spaces_service
from app.modules.spaces.models import Space
from app.modules.users import service as users_service
from tests.fakes import FakeFirebaseAuth, make_identity

COOKIE = {"Cookie": "session=valid-cookie"}
SPACE_NOT_FOUND = {"detail": "Space not found", "code": "space_not_found"}


async def _user_with_space(session: AsyncSession, uid: str) -> tuple[uuid.UUID, uuid.UUID]:
    user = await users_service.upsert_user(
        session, firebase_uid=uid, email=f"{uid}@example.com", display_name=None
    )
    await spaces_service.ensure_personal_space(session, user.id, "America/Montevideo")
    [space] = await spaces_service.list_spaces(session, user.id)
    return user.id, space.id


def _sign_in_as(fake: FakeFirebaseAuth, uid: str) -> None:
    fake.session_identity = make_identity(uid=uid)


async def test_list_returns_only_the_spaces_of_the_user(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_a = await _user_with_space(session, "uid-a")
    _, space_b = await _user_with_space(session, "uid-b")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.get("/spaces", headers=COOKIE)

    assert response.status_code == 200
    assert [s["id"] for s in response.json()] == [str(space_a)]
    assert str(space_b) not in response.text


async def test_list_is_empty_for_a_user_without_spaces(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    await users_service.upsert_user(
        session, firebase_uid="uid-a", email="a@example.com", display_name=None
    )
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.get("/spaces", headers=COOKIE)

    assert response.status_code == 200
    assert response.json() == []


async def test_detail_of_the_personal_space(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.get(f"/spaces/{space_id}", headers=COOKIE)

    assert response.status_code == 200
    assert response.json() == {
        "id": str(space_id),
        "name": "Mi espacio",
        "type": "personal",
        "currency": {"code": "UYU", "exponent": 2},
        "timezone": "America/Montevideo",
    }


async def test_detail_shows_the_exponent_of_a_zero_decimal_currency(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await _user_with_space(session, "uid-a")
    space = await session.get(Space, space_id)
    assert space is not None
    space.currency = "CLP"
    await session.flush()
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.get(f"/spaces/{space_id}", headers=COOKIE)

    assert response.json()["currency"] == {"code": "CLP", "exponent": 0}


async def test_user_b_gets_404_on_the_space_of_user_a(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_a = await _user_with_space(session, "uid-a")
    await _user_with_space(session, "uid-b")
    _sign_in_as(fake_firebase, "uid-b")

    foreign = await api_client.get(f"/spaces/{space_a}", headers=COOKIE)
    missing = await api_client.get(f"/spaces/{uuid.uuid4()}", headers=COOKIE)

    assert foreign.status_code == 404
    assert foreign.json() == SPACE_NOT_FOUND
    assert (foreign.status_code, foreign.json()) == (missing.status_code, missing.json())


async def test_without_a_session_both_routes_are_401(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await _user_with_space(session, "uid-a")

    for path in ("/spaces", f"/spaces/{space_id}"):
        response = await api_client.get(path)
        assert response.status_code == 401, path
        assert response.json()["code"] == "not_authenticated"


async def test_a_space_id_that_is_not_a_uuid_is_a_422(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    await users_service.upsert_user(
        session, firebase_uid="uid-a", email="a@example.com", display_name=None
    )
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.get("/spaces/not-a-uuid", headers=COOKIE)

    assert response.status_code == 422


async def test_trailing_slash_is_a_404(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.get("/spaces/", headers=COOKIE)

    assert response.status_code == 404


async def test_a_cookie_rejected_by_firebase_is_401_on_both_routes(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await _user_with_space(session, "uid-a")
    fake_firebase.session_error = UnauthenticatedError("invalid_session", "Invalid session")

    for path in ("/spaces", f"/spaces/{space_id}"):
        response = await api_client.get(path, headers=COOKIE)
        assert response.status_code == 401, path
        assert response.json() == {"detail": "Invalid session", "code": "invalid_session"}

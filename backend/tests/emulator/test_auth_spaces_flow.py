"""Login, session cookie and spaces through the public API, with the real Firebase adapter.

Integration layer of KAN-4 (HU-3, "Mi espacio" is created on the first login): real accounts and
tokens from the Auth emulator (`docker compose up -d`), the real `verify_session_cookie` and
`createSessionCookie`, the real `/me`, `/spaces` and `/spaces/{id}` routes and PostgreSQL.

What is already covered with the fake Firebase is not repeated here: the origin matrix, the age
matrix of the token, 422s and cookie attributes (`tests/api/test_auth_session.py`). Parallel
logins are in `tests/api/test_auth_concurrent_login.py`.
"""

import uuid
from collections.abc import Awaitable, Callable
from datetime import timedelta

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.spaces.models import Space, SpaceMember
from app.modules.users.models import User
from tests.emulator.helpers import (
    EmulatorAccount,
    assert_error_response,
    delete_account,
    old_id_token,
    sign_in,
)
from tests.fakes import parse_set_cookie, unsigned_id_token

ORIGIN = "http://localhost:3000"
TIMEZONE = "America/Argentina/Buenos_Aires"  # not the one any helper or default uses

NewUser = Callable[..., Awaitable[EmulatorAccount]]
pytestmark = pytest.mark.usefixtures("real_firebase")


async def _login(
    client: AsyncClient, id_token: str, timezone: str = TIMEZONE, origin: str = ORIGIN
) -> Response:
    return await client.post(
        "/auth/session",
        json={"id_token": id_token, "timezone": timezone},
        headers={"Origin": origin},
    )


def _cookie_header(login: Response) -> dict[str, str]:
    name, morsel = parse_set_cookie(login.headers["set-cookie"])
    return {"Cookie": f"{name}={morsel.value}"}


async def _count(session: AsyncSession, model: type[User] | type[Space] | type[SpaceMember]) -> int:
    return (await session.scalar(select(func.count()).select_from(model))) or 0


async def _snapshot(session: AsyncSession) -> tuple[int, int, int]:
    return (
        await _count(session, User),
        await _count(session, Space),
        await _count(session, SpaceMember),
    )


# --- Criterion 1: the first login creates exactly one "Mi espacio" ---------------------------


async def test_first_login_creates_one_personal_space_visible_through_the_api(
    api_client: AsyncClient, session: AsyncSession, emulator_user: NewUser
) -> None:
    account = await emulator_user()

    login = await _login(api_client, account.id_token)

    assert login.status_code == 204
    spaces = await api_client.get("/spaces")
    assert spaces.status_code == 200
    [space] = spaces.json()
    detail = await api_client.get(f"/spaces/{space['id']}")
    assert detail.status_code == 200
    assert detail.json() == {
        "id": space["id"],
        "name": "Mi espacio",
        "type": "personal",
        "currency": {"code": "UYU", "exponent": 2},
        "timezone": TIMEZONE,
    }
    # Exactly one user, one space and one membership, and the user is its owner.
    assert await _snapshot(session) == (1, 1, 1)
    member = await session.scalar(select(SpaceMember))
    user = await session.scalar(select(User).where(User.firebase_uid == account.uid))
    assert member is not None
    assert user is not None
    assert (member.user_id, member.role, str(member.space_id)) == (user.id, "owner", space["id"])


async def test_me_and_spaces_feed_the_home_greeting(
    api_client: AsyncClient, emulator_user: NewUser
) -> None:
    # The home shows "Hola, {name}, tu espacio es Mi espacio": the UI is a frontend task, the API
    # has to hand over both pieces right after the first login.
    account = await emulator_user("Eva E2E")
    await _login(api_client, account.id_token)

    me = await api_client.get("/me")
    spaces = await api_client.get("/spaces")

    assert me.status_code == 200
    assert (me.json()["display_name"], me.json()["email"]) == ("Eva E2E", account.email)
    assert [space["name"] for space in spaces.json()] == ["Mi espacio"]


# --- Criterion 2: a later login does not create another space --------------------------------


async def test_second_login_with_a_new_real_token_keeps_one_space_and_its_timezone(
    api_client: AsyncClient, session: AsyncSession, emulator_user: NewUser, emulator_host: str
) -> None:
    account = await emulator_user()
    await _login(api_client, account.id_token)
    [first] = (await api_client.get("/spaces")).json()
    # A second sign-in of the same account (the emulator may repeat the token within a second).
    second_token = (await sign_in(emulator_host, account)).id_token

    login = await _login(api_client, second_token, timezone="Asia/Tokyo")

    assert login.status_code == 204
    [after] = (await api_client.get("/spaces")).json()
    assert after["id"] == first["id"]
    assert after["timezone"] == TIMEZONE
    assert await _snapshot(session) == (1, 1, 1)


# --- No cookie, invalid cookie, deleted account ----------------------------------------------

PROTECTED_PATHS = ["/me", "/spaces", f"/spaces/{uuid.uuid4()}"]


@pytest.mark.parametrize("path", PROTECTED_PATHS)
async def test_routes_without_cookie_are_401_not_authenticated(
    api_client: AsyncClient, path: str
) -> None:
    response = await api_client.get(path)

    assert_error_response(response, 401, "not_authenticated")


@pytest.mark.parametrize("path", PROTECTED_PATHS)
@pytest.mark.parametrize("kind", ["garbage", "id_token", "unsigned_token"])
async def test_garbage_or_foreign_cookies_are_401_invalid_session_with_the_real_adapter(
    api_client: AsyncClient, emulator_user: NewUser, path: str, kind: str
) -> None:
    account = await emulator_user()
    value = {
        "garbage": "not-a-session-cookie",
        "id_token": account.id_token,  # a valid ID token is not a session cookie
        "unsigned_token": unsigned_id_token(sub=account.uid, email=account.email),
    }[kind]

    response = await api_client.get(path, headers={"Cookie": f"session={value}"})

    assert_error_response(response, 401, "invalid_session")


async def test_a_cookie_of_a_deleted_firebase_account_is_401_invalid_session(
    api_client: AsyncClient, emulator_user: NewUser, emulator_host: str
) -> None:
    account = await emulator_user()
    await _login(api_client, account.id_token)
    assert (await api_client.get("/me")).status_code == 200

    await delete_account(emulator_host, account)

    assert_error_response(await api_client.get("/me"), 401, "invalid_session")


# --- Origin and old token --------------------------------------------------------------------


async def test_a_foreign_origin_login_leaves_the_client_without_a_session(
    api_client: AsyncClient, session: AsyncSession, emulator_user: NewUser
) -> None:
    account = await emulator_user()

    login = await _login(api_client, account.id_token, origin="https://evil.example.com")

    assert_error_response(login, 403, "origin_not_allowed")
    assert "set-cookie" not in login.headers
    assert_error_response(await api_client.get("/me"), 401, "not_authenticated")
    assert await _snapshot(session) == (0, 0, 0)


@pytest.mark.parametrize("age", [timedelta(minutes=5), timedelta(minutes=10)])
async def test_an_old_sign_in_token_is_rejected_and_an_existing_user_keeps_their_one_space(
    api_client: AsyncClient, session: AsyncSession, emulator_user: NewUser, age: timedelta
) -> None:
    account = await emulator_user()
    await _login(api_client, account.id_token)
    api_client.cookies.clear()  # the old token must not be rescued by the earlier session

    login = await _login(api_client, old_id_token(age, account))

    assert_error_response(login, 401, "recent_sign_in_required")
    assert "set-cookie" not in login.headers
    assert_error_response(await api_client.get("/me"), 401, "not_authenticated")
    assert await _snapshot(session) == (1, 1, 1)


# --- IDOR ------------------------------------------------------------------------------------


async def test_user_b_gets_404_on_the_space_of_user_a_with_real_sessions(
    api_client: AsyncClient, emulator_user: NewUser
) -> None:
    ana = await emulator_user("Ana")
    bea = await emulator_user("Bea")
    cookie_a = _cookie_header(await _login(api_client, ana.id_token))
    cookie_b = _cookie_header(await _login(api_client, bea.id_token))
    api_client.cookies.clear()  # every request below carries its own Cookie header
    [space_a] = (await api_client.get("/spaces", headers=cookie_a)).json()
    [space_b] = (await api_client.get("/spaces", headers=cookie_b)).json()
    assert space_a["id"] != space_b["id"]

    foreign = await api_client.get(f"/spaces/{space_a['id']}", headers=cookie_b)
    missing = await api_client.get(f"/spaces/{uuid.uuid4()}", headers=cookie_b)
    listing_b = await api_client.get("/spaces", headers=cookie_b)
    own = await api_client.get(f"/spaces/{space_a['id']}", headers=cookie_a)

    assert_error_response(foreign, 404, "space_not_found")
    assert foreign.json() == missing.json()  # the same body: it does not reveal that it exists
    assert space_a["id"] not in listing_b.text
    assert own.status_code == 200
    assert own.json()["id"] == space_a["id"]


# --- Logout ----------------------------------------------------------------------------------


async def test_logout_clears_the_cookie_and_the_client_is_logged_out(
    api_client: AsyncClient, emulator_user: NewUser
) -> None:
    account = await emulator_user()
    await _login(api_client, account.id_token)
    assert (await api_client.get("/me")).status_code == 200

    logout = await api_client.delete("/auth/session", headers={"Origin": ORIGIN})

    assert logout.status_code == 204
    name, morsel = parse_set_cookie(logout.headers["set-cookie"])
    assert (name, morsel.value, morsel["max-age"]) == ("session", "", "0")
    assert api_client.cookies.get("session") is None
    assert_error_response(await api_client.get("/me"), 401, "not_authenticated")
    assert_error_response(await api_client.get("/spaces"), 401, "not_authenticated")

"""Login, session cookie and spaces through the public API, with the real Firebase adapter.

Integration layer of KAN-4 (HU-3, "Mi espacio" is created on the first login): real accounts and
tokens from the Auth emulator (`docker compose up -d`), the real `verify_session_cookie` and
`createSessionCookie`, the real `/me`, `/spaces` and `/spaces/{id}` routes and PostgreSQL.

What is already covered with the fake Firebase is not repeated here: the origin matrix, the age
matrix of the token, 422s and cookie attributes (`tests/api/test_auth_session.py`). Parallel
logins are in `tests/api/test_auth_concurrent_login.py`.
"""

import io
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
    wait_for_next_second,
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


async def _login_ok(
    client: AsyncClient, id_token: str, timezone: str = TIMEZONE, origin: str = ORIGIN
) -> Response:
    """A login that is only the setup of a test: if it fails, the failure shows up here."""
    response = await _login(client, id_token, timezone, origin)
    assert response.status_code == 204, response.text
    return response


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

    assert login.status_code == 204, login.text
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
    await _login_ok(api_client, account.id_token)

    me = await api_client.get("/me")
    spaces = await api_client.get("/spaces")

    assert me.status_code == 200
    assert (me.json()["display_name"], me.json()["email"]) == ("Eva E2E", account.email)
    assert [space["name"] for space in spaces.json()] == ["Mi espacio"]


# --- Criterion 2: a later login does not create another space --------------------------------


async def test_a_second_real_sign_in_keeps_one_space_and_its_timezone(
    api_client: AsyncClient, session: AsyncSession, emulator_user: NewUser, emulator_host: str
) -> None:
    account = await emulator_user()
    await _login_ok(api_client, account.id_token)
    [first] = (await api_client.get("/spaces")).json()
    # A second sign-in of the same account (the emulator may repeat the token within a second).
    second_token = (await sign_in(emulator_host, account)).id_token

    login = await _login(api_client, second_token, timezone="Asia/Tokyo")

    assert login.status_code == 204, login.text
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
    await _login_ok(api_client, account.id_token)
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
    await _login_ok(api_client, account.id_token)
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
    cookie_a = _cookie_header(await _login_ok(api_client, ana.id_token))
    cookie_b = _cookie_header(await _login_ok(api_client, bea.id_token))
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
    await _login_ok(api_client, account.id_token)
    assert (await api_client.get("/me")).status_code == 200

    logout = await api_client.delete("/auth/session", headers={"Origin": ORIGIN})

    assert logout.status_code == 204
    name, morsel = parse_set_cookie(logout.headers["set-cookie"])
    assert (name, morsel.value, morsel["max-age"]) == ("session", "", "0")
    assert api_client.cookies.get("session") is None
    assert_error_response(await api_client.get("/me"), 401, "not_authenticated")
    assert_error_response(await api_client.get("/spaces"), 401, "not_authenticated")


# --- Logout revokes the session in Firebase (KAN-39) -----------------------------------------
# A cookie issued in the same second as the revocation is not revoked (Firebase compares `iat`
# with second granularity), so the tests that log out wait for the next whole second first.


def _assert_cookie_cleared(logout: Response) -> None:
    assert logout.status_code == 204, logout.text
    name, morsel = parse_set_cookie(logout.headers["set-cookie"])
    assert (name, morsel.value, morsel["max-age"]) == ("session", "", "0")


def _assert_revoked(log_stream: io.StringIO) -> None:
    # A failed revocation is still a 204 (by design): without this the test would only say that
    # the old cookie still works, not that Firebase refused to revoke.
    assert "session_revocation_failed" not in log_stream.getvalue(), log_stream.getvalue()
    assert "session_revoked" in log_stream.getvalue()


async def test_logout_revokes_the_session_in_firebase_so_the_old_cookie_is_401_invalid_session(
    api_client: AsyncClient, emulator_user: NewUser, log_stream: io.StringIO
) -> None:
    account = await emulator_user()
    old_cookie = _cookie_header(await _login_ok(api_client, account.id_token))
    assert (await api_client.get("/me")).status_code == 200
    await wait_for_next_second()

    logout = await api_client.delete("/auth/session", headers={"Origin": ORIGIN})

    _assert_cookie_cleared(logout)
    _assert_revoked(log_stream)
    api_client.cookies.clear()  # what a thief holding the old cookie would send
    for path in ("/me", "/spaces"):
        response = await api_client.get(path, headers=old_cookie)
        assert_error_response(response, 401, "invalid_session")


async def test_logout_ends_the_sessions_of_the_users_other_devices_but_not_other_users(
    api_client: AsyncClient, emulator_user: NewUser, emulator_host: str, log_stream: io.StringIO
) -> None:
    ana = await emulator_user("Ana")
    bea = await emulator_user("Bea")
    phone = _cookie_header(await _login_ok(api_client, ana.id_token))
    ana_on_laptop = await sign_in(emulator_host, ana)  # a second sign-in: another device
    laptop = _cookie_header(await _login_ok(api_client, ana_on_laptop.id_token))
    bea_phone = _cookie_header(await _login_ok(api_client, bea.id_token))
    api_client.cookies.clear()  # every request below carries its own Cookie header
    for cookie in (phone, laptop, bea_phone):
        assert (await api_client.get("/me", headers=cookie)).status_code == 200
    await wait_for_next_second()

    logout = await api_client.delete("/auth/session", headers={"Origin": ORIGIN, **phone})

    _assert_cookie_cleared(logout)
    _assert_revoked(log_stream)
    assert_error_response(await api_client.get("/me", headers=phone), 401, "invalid_session")
    assert_error_response(await api_client.get("/me", headers=laptop), 401, "invalid_session")
    still_logged_in = await api_client.get("/me", headers=bea_phone)
    assert still_logged_in.status_code == 200
    assert still_logged_in.json()["email"] == bea.email


async def test_a_user_can_log_in_again_after_logging_out_everywhere(
    api_client: AsyncClient, emulator_user: NewUser, emulator_host: str
) -> None:
    account = await emulator_user()
    await _login_ok(api_client, account.id_token)
    await wait_for_next_second()
    _assert_cookie_cleared(await api_client.delete("/auth/session", headers={"Origin": ORIGIN}))

    again = await sign_in(emulator_host, account)
    await _login_ok(api_client, again.id_token)

    assert (await api_client.get("/me")).status_code == 200
    assert len((await api_client.get("/spaces")).json()) == 1  # still the one personal space


@pytest.mark.parametrize("kind", ["garbage", "id_token", "already_revoked", "deleted_account"])
async def test_logout_with_a_cookie_that_is_not_valid_is_204_and_clears_it(
    api_client: AsyncClient, emulator_user: NewUser, emulator_host: str, kind: str
) -> None:
    account = await emulator_user()
    real_cookie = _cookie_header(await _login_ok(api_client, account.id_token))
    api_client.cookies.clear()
    cookie = {
        "garbage": {"Cookie": "session=not-a-session-cookie"},
        "id_token": {"Cookie": f"session={account.id_token}"},  # an ID token is not a cookie
        "already_revoked": real_cookie,
        "deleted_account": real_cookie,
    }[kind]
    if kind == "already_revoked":
        await wait_for_next_second()
        first = await api_client.delete("/auth/session", headers={"Origin": ORIGIN, **real_cookie})
        _assert_cookie_cleared(first)
    if kind == "deleted_account":
        await delete_account(emulator_host, account)

    logout = await api_client.delete("/auth/session", headers={"Origin": ORIGIN, **cookie})

    _assert_cookie_cleared(logout)

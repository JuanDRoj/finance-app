"""Helpers for the tests that run against the real Firebase Auth emulator.

Accounts are created and deleted one by one (`accounts:signUp` / `accounts:delete`). Nothing here
clears the whole emulator: other people's accounts (the dev UI, the frontend) live in it too.
"""

import asyncio
import re
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient, Response

from tests.fakes import unsigned_id_token

FAKE_API_KEY = "fake-api-key"  # the emulator ignores it
PASSWORD = "correct-horse-battery"  # noqa: S105  # emulator-only account

_REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{1,64}")


@dataclass(frozen=True, slots=True)
class EmulatorAccount:
    """An account of the emulator and the ID token its last sign-in returned."""

    uid: str
    email: str
    display_name: str
    id_token: str


def unique_email() -> str:
    return f"qa-{uuid.uuid4().hex[:12]}@example.com"


def _url(emulator_host: str, method: str) -> str:
    return f"http://{emulator_host}/identitytoolkit.googleapis.com/v1/{method}"


async def sign_up(emulator_host: str, email: str, display_name: str) -> EmulatorAccount:
    """Create an account in the emulator; its ID token is fresh (`auth_time` = now)."""
    async with AsyncClient() as http:
        response = await http.post(
            _url(emulator_host, "accounts:signUp"),
            params={"key": FAKE_API_KEY},
            json={
                "email": email,
                "password": PASSWORD,
                "displayName": display_name,
                "returnSecureToken": True,
            },
        )
    response.raise_for_status()
    body = response.json()
    return EmulatorAccount(
        uid=str(body["localId"]), email=email, display_name=display_name, id_token=body["idToken"]
    )


async def sign_in(emulator_host: str, account: EmulatorAccount) -> EmulatorAccount:
    """A second sign-in of an existing account: a new ID token for the same uid."""
    async with AsyncClient() as http:
        response = await http.post(
            _url(emulator_host, "accounts:signInWithPassword"),
            params={"key": FAKE_API_KEY},
            json={"email": account.email, "password": PASSWORD, "returnSecureToken": True},
        )
    response.raise_for_status()
    return EmulatorAccount(
        uid=account.uid,
        email=account.email,
        display_name=account.display_name,
        id_token=response.json()["idToken"],
    )


async def delete_account(emulator_host: str, account: EmulatorAccount) -> None:
    """Delete one account.

    Only "the account is already gone" is tolerated (a test deleted it itself): the emulator
    answers it with a 400 whose `error.message` is `USER_NOT_FOUND`. Any other failure raises.
    If a test revoked the account's sessions, its ID token is refused (`TOKEN_EXPIRED`): the
    account then signs in again (a token issued after the revocation) and is deleted with that.
    """
    id_token = account.id_token
    async with AsyncClient() as http:
        response = await _post_delete(http, emulator_host, id_token)
        if response.status_code == 400 and response.json()["error"]["message"] == "TOKEN_EXPIRED":
            id_token = (await sign_in(emulator_host, account)).id_token
            response = await _post_delete(http, emulator_host, id_token)
    if response.status_code == 400 and response.json()["error"]["message"] == "USER_NOT_FOUND":
        return
    response.raise_for_status()


async def _post_delete(http: AsyncClient, emulator_host: str, id_token: str) -> Response:
    return await http.post(
        _url(emulator_host, "accounts:delete"),
        params={"key": FAKE_API_KEY},
        json={"idToken": id_token},
    )


def old_id_token(age: timedelta, account: EmulatorAccount) -> str:
    """An unsigned ID token of `account` whose sign-in happened `age` ago.

    The emulator signs tokens only for a sign-in that is happening now, so an old one cannot be
    asked for. The unsigned token is accepted by firebase-admin in emulator mode (it checks just
    aud, iss and sub), which is enough to reach our own `auth_time` check; it is refused before
    the emulator is asked for a session cookie, so it can only ever produce a 401.
    """
    auth_time = int((datetime.now(UTC) - age).timestamp())
    return unsigned_id_token(
        sub=account.uid, email=account.email, name=account.display_name, auth_time=auth_time
    )


async def wait_for_next_second() -> None:
    """Wait until the wall clock is in the next whole second (about a second at most).

    Firebase compares a cookie's `iat` with the revocation time at one-second granularity: a
    cookie issued in the same second as `revoke_refresh_tokens` is NOT revoked. A test that logs
    in and then logs out must call this in between, or it passes or fails by the clock. In
    production the case does not matter (nobody logs in and out within one second).

    It polls the wall clock (the one `iat` and the revocation time come from) instead of sleeping
    once for the computed time: a single sleep runs on the monotonic clock, which can wake it up
    before the wall clock has reached the next second if the latter is stepped (a VM time sync).
    """
    second = int(time.time())
    while int(time.time()) == second:  # noqa: ASYNC110  # the wall clock has no Event to await
        await asyncio.sleep(0.02)


def assert_error_response(response: Response, status: int, code: str) -> None:
    """The single error format of the API (BE-08): `{"detail", "code"}` and an `X-Request-ID`."""
    assert response.status_code == status, response.text
    assert response.headers["content-type"].startswith("application/json")
    body = response.json()
    assert set(body) == {"detail", "code"}
    assert body["code"] == code
    assert isinstance(body["detail"], str)
    assert body["detail"]
    assert _REQUEST_ID.fullmatch(response.headers["x-request-id"])
    for leak in ("Traceback", "SELECT ", "INSERT "):
        assert leak not in response.text

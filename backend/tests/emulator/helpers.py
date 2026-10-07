"""Helpers for the tests that run against the real Firebase Auth emulator.

Accounts are created (`accounts:signUp`) and deleted one by one, by uid. Nothing here clears the
whole emulator: other people's accounts (the dev UI, the frontend) live in it too.
"""

import asyncio
import base64
import json
import re
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient, Response

from tests.fakes import DEMO_PROJECT_ID, unsigned_id_token

FAKE_API_KEY = "fake-api-key"  # the emulator ignores it
PASSWORD = "correct-horse-battery"  # noqa: S105  # emulator-only account
# Extra time `wait_until_revocable` waits past the second of the cookie, so that a small backward
# step of the clock does not undo the wait.
CLOCK_STEP_MARGIN_SECONDS = 0.25
# Longest `wait_until_revocable` waits: the cookie of a test is at most a second or so old.
MAX_REVOCABLE_WAIT_SECONDS = 5.0

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
    """Delete one account, by its uid, through the emulator's admin route.

    Not with the account's ID token: a test that revoked the account's sessions makes the emulator
    refuse every token whose `iat` is not later than the revocation (`TOKEN_EXPIRED`), a fresh
    sign-in included when the clock of this machine steps back by a few milliseconds.

    Only "the account is already gone" is tolerated (a test deleted it itself): the emulator
    answers it with a 400 whose `error.message` is `USER_NOT_FOUND`. Any other failure raises.
    """
    async with AsyncClient() as http:
        response = await http.post(
            _url(emulator_host, f"projects/{DEMO_PROJECT_ID}/accounts:delete"),
            headers={"Authorization": "Bearer owner"},  # the emulator's admin credential
            json={"localId": account.uid},
        )
    if response.status_code == 400 and response.json()["error"]["message"] == "USER_NOT_FOUND":
        return
    # The body says why (`error.message`); `raise_for_status` would only say "400 Bad Request".
    assert response.is_success, f"accounts:delete failed: {response.status_code} {response.text}"


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


def session_cookie_iat(cookie: str) -> int:
    """The `iat` (seconds) of a session cookie of the emulator, which is an unsigned JWT."""
    payload = cookie.split(".")[1]
    claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    return int(claims["iat"])


async def wait_until_revocable(*cookies: str) -> None:
    """Wait until a revocation made now revokes every one of `cookies` (session cookie values).

    firebase-admin treats a cookie as revoked when `iat < validSince`, both in whole seconds: a
    cookie issued in the same second as `revoke_refresh_tokens` survives it. So a test that logs
    in and then logs out must wait in between, or it passes or fails by the clock. The wait is
    until the wall clock is past `iat + 1` of the newest cookie (plus a margin), which is `iat`
    read from the cookie itself, not a guess from the time it was issued. In production the case
    does not matter (nobody logs in and out within one second).

    The cookie's `iat` comes from the emulator's clock and `validSince` from the emulator's too
    (it ignores the one firebase-admin sends, `int(time.time())`, which real Firebase uses). Here
    both are this machine's wall clock, which is what is awaited. The loop re-reads it instead of
    trusting one sleep (that runs on the monotonic clock); the margin is for the clock of WSL2,
    which sometimes steps back a few milliseconds and would put the revocation (or a sign-in
    after it) back in the previous second.

    Fails, instead of hanging, if the newest `iat` is more than `MAX_REVOCABLE_WAIT_SECONDS` ahead
    of this machine's clock: the emulator's clock is out of step with it.
    """
    ready_at = max(session_cookie_iat(cookie) for cookie in cookies) + 1 + CLOCK_STEP_MARGIN_SECONDS
    ahead = ready_at - time.time()
    if ahead > MAX_REVOCABLE_WAIT_SECONDS:
        raise AssertionError(
            f"The session cookie was issued {ahead:.0f} s ahead of this machine's clock: the "
            "clock of the Auth emulator is out of step with it (restart Docker or sync the clock)"
        )
    while (remaining := ready_at - time.time()) > 0:  # noqa: ASYNC110  # no Event for a clock
        await asyncio.sleep(remaining)


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

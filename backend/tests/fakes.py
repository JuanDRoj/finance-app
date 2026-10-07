"""Test doubles and helpers for the Firebase boundary (no network, no emulator)."""

import base64
import json
import time
from datetime import UTC, datetime, timedelta
from http.cookies import Morsel, SimpleCookie

from app.modules.auth.firebase import FirebaseIdentity

DEMO_PROJECT_ID = "demo-finance-local"


def make_identity(
    *,
    uid: str = "uid-1",
    email: str | None = "ana@example.com",
    name: str | None = "Ana Pérez",
    auth_age: timedelta | None = timedelta(seconds=30),
    now: datetime | None = None,
) -> FirebaseIdentity:
    """An identity whose sign-in happened `auth_age` before `now` (default: the current time).

    `auth_age=None` builds a token without `auth_time`.
    """
    auth_time = None if auth_age is None else (now or datetime.now(UTC)) - auth_age
    return FirebaseIdentity(uid=uid, email=email, name=name, auth_time=auth_time)


class FakeFirebaseAuth:
    """Stands in for the real adapter: records the calls and returns or raises what it is told."""

    def __init__(self) -> None:
        self.identity = make_identity()
        self.verify_error: Exception | None = None
        self.cookie_error: Exception | None = None
        self.session_error: Exception | None = None
        self.revoke_error: Exception | None = None
        self.revoke_result = True  # False: the account no longer exists, nothing was revoked
        self.session_identity = make_identity()
        self.verified_cookies: list[str] = []
        self.revoked_uids: list[str] = []
        self.cookie_value = "fake-session-cookie"
        self.verified_tokens: list[str] = []
        self.cookie_requests: list[tuple[str, timedelta]] = []

    @property
    def called(self) -> bool:
        return bool(
            self.verified_tokens
            or self.cookie_requests
            or self.verified_cookies
            or self.revoked_uids
        )

    async def verify_id_token(self, id_token: str) -> FirebaseIdentity:
        self.verified_tokens.append(id_token)
        if self.verify_error is not None:
            raise self.verify_error
        return self.identity

    async def verify_session_cookie(self, cookie: str) -> FirebaseIdentity:
        self.verified_cookies.append(cookie)
        if self.session_error is not None:
            raise self.session_error
        return self.session_identity

    async def create_session_cookie(self, id_token: str, expires_in: timedelta) -> str:
        self.cookie_requests.append((id_token, expires_in))
        if self.cookie_error is not None:
            raise self.cookie_error
        return self.cookie_value

    async def revoke_refresh_tokens(self, uid: str) -> bool:
        self.revoked_uids.append(uid)
        if self.revoke_error is not None:
            raise self.revoke_error
        return self.revoke_result


def _b64(data: dict[str, object]) -> str:
    raw = json.dumps(data).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def unsigned_id_token(project_id: str = DEMO_PROJECT_ID, **claims: object) -> str:
    """An unsigned (`alg: none`) ID token like the Auth emulator issues.

    firebase-admin accepts these only when FIREBASE_AUTH_EMULATOR_HOST is set, and then checks
    just the structural claims (aud, iss, sub): neither the signature nor `exp`. Handy to run the
    real adapter with claims of our choice and no network.
    """
    now = int(time.time())
    payload: dict[str, object] = {
        "iss": f"https://securetoken.google.com/{project_id}",
        "aud": project_id,
        "sub": "uid-1",
        "iat": now,
        "exp": now + 3600,
        "auth_time": now,
        "email": "ana@example.com",
        "name": "Ana Pérez",
    }
    payload.update(claims)
    # Claims given as None are removed, to build tokens that lack them.
    payload = {key: value for key, value in payload.items() if value is not None}
    return f"{_b64({'alg': 'none', 'typ': 'JWT'})}.{_b64(payload)}."


def parse_set_cookie(header: str) -> tuple[str, Morsel[str]]:
    """(name, morsel) of a Set-Cookie header, to read its attributes."""
    jar: SimpleCookie = SimpleCookie()
    jar.load(header)
    name = next(iter(jar))
    return name, jar[name]

"""The boundary with Firebase Authentication: the only file that imports `firebase_admin`.

`FirebaseAuth` is the part of it that the app uses (a Protocol, like `CloudSqlConnector` in
`app/core/db.py`: it is an external boundary, so tests replace it with a fake). `firebase-admin`
is synchronous, so every call runs in a thread. Token errors become a 401; anything else
(Google unreachable, missing IAM permission...) is not the client's fault and is left to surface
as the generic 500 with its traceback in the log.
"""

import asyncio
import logging
import os
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from app.core.config import Settings
from app.core.errors import UnauthenticatedError

logger = logging.getLogger(__name__)

EMULATOR_HOST_ENV_VAR = "FIREBASE_AUTH_EMULATOR_HOST"
# Seconds of clock difference tolerated when checking `iat`/`exp` (firebase-admin allows 0-60).
CLOCK_SKEW_SECONDS = 10


@dataclass(frozen=True, slots=True)
class FirebaseIdentity:
    """What the app reads from a verified ID token. A missing claim is None."""

    uid: str
    email: str | None
    name: str | None
    auth_time: datetime | None


class FirebaseAuth(Protocol):
    async def verify_id_token(self, id_token: str) -> FirebaseIdentity:
        """Verify the token; `UnauthenticatedError("invalid_id_token")` if it is not valid."""
        ...

    async def verify_session_cookie(self, cookie: str) -> FirebaseIdentity:
        """Verify the session cookie, revocation included (a call to Firebase every time).

        `UnauthenticatedError("invalid_session")` if it is invalid, expired or revoked, or if the
        account is disabled or deleted.
        """
        ...

    async def create_session_cookie(self, id_token: str, expires_in: timedelta) -> str:
        """Exchange a (verified) ID token for a session cookie that lasts `expires_in`."""
        ...

    async def revoke_refresh_tokens(self, uid: str) -> bool:
        """Revoke every session cookie and refresh token of the account, on all its devices.

        True if the sessions were revoked; False if the account no longer exists (it is not an
        error: there was nothing to revoke). Any other failure is raised as is.

        Firebase compares a cookie's `iat` with the revocation time in whole seconds: a cookie
        issued in the same second as the revocation is not revoked.
        """
        ...


def _invalid_id_token() -> UnauthenticatedError:
    # The message is fixed on purpose: Firebase's own text can quote claims of the token.
    return UnauthenticatedError("invalid_id_token", "Invalid ID token")


def _invalid_session() -> UnauthenticatedError:
    return UnauthenticatedError("invalid_session", "Invalid session")


def _optional_text(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _auth_time(value: object) -> datetime | None:
    # bool is an int in Python; `true` is not a timestamp.
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    try:
        return datetime.fromtimestamp(value, UTC)
    except OverflowError, OSError, ValueError:
        return None


def _identity(claims: dict[str, Any]) -> FirebaseIdentity:
    return FirebaseIdentity(
        uid=str(claims["uid"]),
        email=_optional_text(claims.get("email")),
        name=_optional_text(claims.get("name")),
        auth_time=_auth_time(claims.get("auth_time")),
    )


class FirebaseAdminAuth:
    """`FirebaseAuth` over firebase-admin, bound to one Firebase app (one project)."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def verify_id_token(self, id_token: str) -> FirebaseIdentity:
        from firebase_admin import auth

        try:
            claims = await asyncio.to_thread(
                auth.verify_id_token, id_token, app=self.app, clock_skew_seconds=CLOCK_SKEW_SECONDS
            )
        except (ValueError, auth.InvalidIdTokenError, auth.UserDisabledError) as error:
            # ExpiredIdTokenError and RevokedIdTokenError are InvalidIdTokenError subclasses.
            # Only the class name is logged: Firebase's message can quote claims of the token.
            logger.info("id_token_rejected", extra={"firebase_error": type(error).__name__})
            raise _invalid_id_token() from None
        return _identity(claims)

    async def verify_session_cookie(self, cookie: str) -> FirebaseIdentity:
        from firebase_admin import auth

        try:
            claims = await asyncio.to_thread(
                auth.verify_session_cookie,
                cookie,
                check_revoked=True,
                app=self.app,
                clock_skew_seconds=CLOCK_SKEW_SECONDS,
            )
        except (
            ValueError,
            auth.InvalidSessionCookieError,  # expired and revoked are subclasses
            auth.UserDisabledError,
            auth.UserNotFoundError,  # the revocation check looks the account up: deleted
        ) as error:
            logger.info("session_cookie_rejected", extra={"firebase_error": type(error).__name__})
            raise _invalid_session() from None
        # CertificateFetchError and other failures reaching Google are not the client's fault:
        # they surface as the generic 500.
        return _identity(claims)

    async def create_session_cookie(self, id_token: str, expires_in: timedelta) -> str:
        from firebase_admin import auth

        try:
            cookie = await asyncio.to_thread(
                auth.create_session_cookie, id_token, expires_in, app=self.app
            )
        except auth.InvalidIdTokenError as error:
            logger.info("id_token_rejected", extra={"firebase_error": type(error).__name__})
            raise _invalid_id_token() from None
        return cookie.decode() if isinstance(cookie, bytes) else str(cookie)

    async def revoke_refresh_tokens(self, uid: str) -> bool:
        from firebase_admin import auth

        try:
            await asyncio.to_thread(auth.revoke_refresh_tokens, uid, app=self.app)
        except auth.UserNotFoundError:
            # Deleted between the verification and now: its sessions are gone with it.
            logger.info("revocation_skipped_account_gone")
            return False
        return True

    def close(self) -> None:
        """Release the Firebase app (shutdown)."""
        import firebase_admin

        firebase_admin.delete_app(self.app)


def create_firebase_auth(settings: Settings) -> FirebaseAdminAuth:
    """Initialise firebase-admin for the configured project. It opens no connection yet.

    firebase-admin finds the emulator by reading os.environ, not our settings (which may come
    from `backend/.env`), so the host is copied there first, or removed when the settings have
    none: os.environ must always agree with `Settings`, because firebase-admin treats any
    non-empty value as an emulator and then skips the signature check. The rule that the emulator
    never runs outside local is the `Settings` validator: by now the host can only be set in local.
    """
    import firebase_admin

    host = settings.FIREBASE_AUTH_EMULATOR_HOST
    if host:
        os.environ[EMULATOR_HOST_ENV_VAR] = host
        logger.info("firebase_auth_emulator_enabled", extra={"emulator_host": host})
    else:
        os.environ.pop(EMULATOR_HOST_ENV_VAR, None)
        if settings.FIREBASE_PROJECT_ID and settings.FIREBASE_PROJECT_ID.startswith("demo-"):
            # A `demo-` project only exists inside the emulator: real Google rejects its tokens.
            logger.warning("firebase_demo_project_without_emulator")

    # A named app (not the global default): several can coexist and each one can be deleted.
    app = firebase_admin.initialize_app(
        options={"projectId": settings.FIREBASE_PROJECT_ID}, name=f"finance-{uuid.uuid4().hex[:8]}"
    )
    return FirebaseAdminAuth(app)

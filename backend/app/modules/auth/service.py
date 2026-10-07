"""Start and end of a session.

Start: verify the ID token and exchange it for a session cookie. End: revoke the user's sessions.

No HTTP and no database here. Creating the user and the personal space is the router's job
(`users` and `auth` are level 0 and `spaces` level 2, so this service cannot call them).
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from app.core.errors import UnauthenticatedError
from app.modules.auth.firebase import FirebaseAuth

logger = logging.getLogger(__name__)

# Firebase's own maximum for a session cookie.
SESSION_DURATION = timedelta(days=14)
# Firebase recommends creating a session only for a recent sign-in (a stolen old ID token must
# not be exchangeable for two weeks of access).
MAX_SIGN_IN_AGE = timedelta(minutes=5)


@dataclass(frozen=True, slots=True)
class NewSession:
    firebase_uid: str
    email: str
    display_name: str | None
    cookie: str


def _reject(code: str, detail: str) -> UnauthenticatedError:
    # Never the token, the cookie or the email: only why it was refused.
    logger.warning("session_rejected", extra={"reason": code})
    return UnauthenticatedError(code, detail)


async def create_session(firebase: FirebaseAuth, id_token: str, *, now: datetime) -> NewSession:
    """Verify `id_token` (valid, with a sign-in under five minutes old) and create the cookie.

    Raises `UnauthenticatedError`: `invalid_id_token`, `email_required` (the account has no
    email: the app needs it) or `recent_sign_in_required`.
    """
    try:
        identity = await firebase.verify_id_token(id_token)
    except UnauthenticatedError as error:
        logger.warning("session_rejected", extra={"reason": error.code})
        raise
    if identity.auth_time is None:
        raise _reject("invalid_id_token", "Invalid ID token")
    if not identity.email:
        raise _reject("email_required", "The account has no email")
    if now - identity.auth_time >= MAX_SIGN_IN_AGE:
        raise _reject("recent_sign_in_required", "Sign in again to start a session")
    cookie = await firebase.create_session_cookie(id_token, SESSION_DURATION)
    return NewSession(
        firebase_uid=identity.uid,
        email=identity.email,
        display_name=identity.name,
        cookie=cookie,
    )


# What `end_session` did: revoked the user's sessions, had no valid session to revoke (no cookie,
# or one that was invalid, expired or already revoked), or could not reach Firebase.
SessionEnd = Literal["revoked", "no_session", "revocation_failed"]


async def end_session(firebase: FirebaseAuth, cookie: str | None) -> SessionEnd:
    """Log out everywhere: revoke every session of the user that owns `cookie`.

    The uid comes only from a cookie Firebase has just verified (revocation included), so an
    expired or already revoked cookie cannot revoke anything. Logging out is best effort and never
    raises because of Firebase: the caller clears the cookie whatever the outcome, so a Firebase
    problem cannot leave the user stuck logged in. When the revocation could not be done (the
    session stays valid in Firebase until its cookie expires) it is logged as an ERROR, with the
    uid when it is known so that it can be revoked by hand. Never the cookie or Firebase's message.
    """
    if not cookie:
        return "no_session"
    uid: str | None = None
    try:
        uid = (await firebase.verify_session_cookie(cookie)).uid
        await firebase.revoke_refresh_tokens(uid)
    except UnauthenticatedError:
        return "no_session"  # the adapter has logged why it was rejected
    except Exception as error:
        # Deliberately broad: `firebase_admin` cannot be imported here to catch its own
        # `FirebaseError`, and logging out must work whatever goes wrong talking to Google.
        # `CancelledError` is a `BaseException`, so it is not swallowed.
        extra: dict[str, str] = {"firebase_error": type(error).__name__}
        if uid is not None:
            extra["firebase_uid"] = uid
        logger.error("session_revocation_failed", extra=extra)
        return "revocation_failed"
    logger.info("session_revoked")
    return "revoked"

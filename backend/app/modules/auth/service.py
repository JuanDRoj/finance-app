"""Start of a session: verify the ID token and exchange it for a session cookie.

No HTTP and no database here. Creating the user and the personal space is the router's job
(`users` and `auth` are level 0 and `spaces` level 2, so this service cannot call them).
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta

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

    Raises `UnauthenticatedError`: `invalid_id_token` or `recent_sign_in_required`.
    """
    try:
        identity = await firebase.verify_id_token(id_token)
    except UnauthenticatedError as error:
        logger.warning("session_rejected", extra={"reason": error.code})
        raise
    if identity.auth_time is None or not identity.email:
        raise _reject("invalid_id_token", "Invalid ID token")
    if now - identity.auth_time >= MAX_SIGN_IN_AGE:
        raise _reject("recent_sign_in_required", "Sign in again to start a session")
    cookie = await firebase.create_session_cookie(id_token, SESSION_DURATION)
    return NewSession(
        firebase_uid=identity.uid,
        email=identity.email,
        display_name=identity.name,
        cookie=cookie,
    )

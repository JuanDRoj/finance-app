from typing import Annotated

from fastapi import Depends, Request

from app.core.config import SettingsDep
from app.core.db import DbSession
from app.core.errors import ForbiddenError, UnauthenticatedError
from app.modules.auth.firebase import FirebaseAuth
from app.modules.users import service as users_service
from app.modules.users.schemas import UserRead


def get_firebase_auth(request: Request) -> FirebaseAuth:
    """The Firebase boundary of the running app (set in the lifespan). Tests override this one."""
    firebase = getattr(request.app.state, "firebase", None)
    if firebase is None:
        raise RuntimeError("Firebase is not initialised (the app lifespan did not run)")
    return firebase  # type: ignore[no-any-return]


FirebaseDep = Annotated[FirebaseAuth, Depends(get_firebase_auth)]


def require_allowed_origin(request: Request, settings: SettingsDep) -> None:
    """403 unless the request comes from the frontend (CSRF defence for the cookie routes).

    Browsers always send `Origin` on a POST or DELETE; a missing one (curl, a script) is refused
    too. The comparison is exact: `Origin: null` or a different port never matches. The header is
    read from the request, not declared as a `Header` parameter: the browser sets it, the typed
    client must not ask for it, and a declared parameter would make FastAPI document a 422 that
    can never happen (a missing header is a 403 here).
    """
    origin = request.headers.get("origin")
    if origin is None or origin.lower() not in settings.ALLOWED_ORIGINS:
        raise ForbiddenError("origin_not_allowed", "Origin not allowed")


async def get_current_user(
    request: Request, settings: SettingsDep, firebase: FirebaseDep, session: DbSession
) -> UserRead:
    """The logged-in user, from the session cookie; 401 if there is none or it is not valid.

    The cookie is verified with Firebase first (revocation included, so a call to Google on every
    request) and the database is only touched afterwards. Whatever the cause, the client gets the
    same two codes: `not_authenticated` (no cookie) or `invalid_session`. A valid cookie whose
    user has no row here is also `invalid_session`. If Firebase itself cannot be reached the error
    is not handled here: it is the generic 500.
    """
    cookie = request.cookies.get(settings.session_cookie_name)
    if not cookie:
        raise UnauthenticatedError("not_authenticated", "Not authenticated")
    identity = await firebase.verify_session_cookie(cookie)
    user = await users_service.get_by_firebase_uid(session, identity.uid)
    if user is None:
        raise UnauthenticatedError("invalid_session", "Invalid session")
    return user


CurrentUser = Annotated[UserRead, Depends(get_current_user)]

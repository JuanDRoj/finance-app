from typing import Annotated

from fastapi import Depends, Request

from app.core.config import SettingsDep
from app.core.errors import ForbiddenError
from app.modules.auth.firebase import FirebaseAuth


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

from typing import Annotated

from fastapi import Depends, Header, Request

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


def require_allowed_origin(
    settings: SettingsDep, origin: Annotated[str | None, Header(include_in_schema=False)] = None
) -> None:
    """403 unless the request comes from the frontend (CSRF defence for the cookie routes).

    Browsers always send `Origin` on a POST or DELETE; a missing one (curl, a script) is refused
    too. The comparison is exact: `Origin: null` or a different port never matches. The header is
    kept out of the OpenAPI schema: the browser sets it, the typed client must not ask for it.
    """
    if origin is None or origin.lower() not in settings.ALLOWED_ORIGINS:
        raise ForbiddenError("origin_not_allowed", "Origin not allowed")

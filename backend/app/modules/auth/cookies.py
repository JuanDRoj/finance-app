"""The session cookie. Setting and clearing share their attributes on purpose.

`__Host-session` (everywhere but local) is only accepted with `Secure`, `Path=/` and no `Domain`,
and a header that clears it must repeat those attributes or the browser ignores it.
"""

from starlette.responses import Response

from app.core.config import Settings
from app.modules.auth.service import SESSION_DURATION


def set_session_cookie(response: Response, settings: Settings, value: str) -> None:
    response.set_cookie(
        settings.session_cookie_name,
        value,
        max_age=int(SESSION_DURATION.total_seconds()),
        path="/",
        secure=settings.session_cookie_secure,
        httponly=True,
        samesite="lax",
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        settings.session_cookie_name,
        path="/",
        secure=settings.session_cookie_secure,
        httponly=True,
        samesite="lax",
    )

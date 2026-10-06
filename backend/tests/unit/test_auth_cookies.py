from typing import Any

import pytest
from starlette.responses import Response

from app.core.config import Settings
from app.modules.auth.cookies import clear_session_cookie, set_session_cookie
from tests.fakes import parse_set_cookie

STAGING = {
    "DATABASE_URL": "postgresql+asyncpg://u:p@db.internal/finance",
    "FIREBASE_PROJECT_ID": "finance-staging",
    "ALLOWED_ORIGINS": "https://app.example.com",
}

BY_ENV = [
    ("local", "session", False),
    ("staging", "__Host-session", True),
    ("prod", "__Host-session", True),
]


def _settings(env: str) -> Settings:
    if env == "local":
        return Settings(_env_file=None)
    values: dict[str, Any] = {**STAGING, "ENV": env}
    return Settings(_env_file=None, **values)


def _only_set_cookie(response: Response) -> str:
    headers = [value.decode() for key, value in response.raw_headers if key == b"set-cookie"]
    assert len(headers) == 1
    return headers[0]


@pytest.mark.parametrize(("env", "name", "secure"), BY_ENV)
def test_the_session_cookie_has_the_flags_of_its_environment(
    env: str, name: str, secure: bool
) -> None:
    response = Response()

    set_session_cookie(response, _settings(env), "the-cookie-value")

    cookie_name, morsel = parse_set_cookie(_only_set_cookie(response))
    assert cookie_name == name
    assert morsel.value == "the-cookie-value"
    assert bool(morsel["httponly"]) is True
    assert bool(morsel["secure"]) is secure
    assert morsel["samesite"].lower() == "lax"
    assert morsel["path"] == "/"
    assert morsel["max-age"] == str(14 * 24 * 3600)
    assert morsel["domain"] == ""  # a __Host- cookie must not carry a Domain


@pytest.mark.parametrize(("env", "name", "secure"), BY_ENV)
def test_clearing_the_cookie_repeats_the_attributes_the_browser_needs(
    env: str, name: str, secure: bool
) -> None:
    response = Response()

    clear_session_cookie(response, _settings(env))

    cookie_name, morsel = parse_set_cookie(_only_set_cookie(response))
    assert cookie_name == name
    assert morsel.value == ""
    assert morsel["max-age"] == "0"
    # A __Host- cookie is only overwritten by a header that is also Secure with Path=/.
    assert bool(morsel["secure"]) is secure
    assert bool(morsel["httponly"]) is True
    assert morsel["samesite"].lower() == "lax"
    assert morsel["path"] == "/"
    assert morsel["domain"] == ""

"""POST/DELETE /auth/session with a fake Firebase boundary and the real database.

This route is not under /spaces/{space_id}, so there is no IDOR case; "user B never gets user A's
space" is covered by `test_two_users_get_separate_personal_spaces`.
"""

import io
import json
from collections.abc import Callable
from datetime import timedelta

import pytest
from fastapi import FastAPI
from httpx import AsyncClient, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.errors import UnauthenticatedError
from app.modules.spaces import service as spaces_service
from app.modules.spaces.models import Space, SpaceMember
from app.modules.users.models import User
from tests.fakes import FakeFirebaseAuth, make_identity, parse_set_cookie

URL = "/auth/session"
LOCAL_ORIGIN = "http://localhost:3000"
STAGING_ORIGIN = "https://app.example.com"
BODY = {"id_token": "id-token-123", "timezone": "America/Montevideo"}


async def _count(session: AsyncSession, model: type[User] | type[Space] | type[SpaceMember]) -> int:
    return (await session.scalar(select(func.count()).select_from(model))) or 0


async def _snapshot(session: AsyncSession) -> tuple[int, int, int]:
    return (
        await _count(session, User),
        await _count(session, Space),
        await _count(session, SpaceMember),
    )


@pytest.fixture
def use_settings(app: FastAPI) -> Callable[[Settings], None]:
    def use(settings: Settings) -> None:
        app.dependency_overrides[get_settings] = lambda: settings

    return use


@pytest.fixture
def staging(
    settings_factory: Callable[..., Settings], use_settings: Callable[[Settings], None]
) -> Callable[..., Settings]:
    def make(env: str = "staging") -> Settings:
        settings = settings_factory(
            ENV=env, FIREBASE_PROJECT_ID="finance-staging", ALLOWED_ORIGINS=STAGING_ORIGIN
        )
        use_settings(settings)
        return settings

    return make


# --- Happy path -----------------------------------------------------------------------------


async def test_login_sets_the_cookie_and_creates_the_user_and_the_personal_space(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    response = await api_client.post(URL, json=BODY, headers={"Origin": LOCAL_ORIGIN})

    assert response.status_code == 204
    assert response.content == b""
    assert fake_firebase.verified_tokens == ["id-token-123"]
    assert fake_firebase.cookie_requests == [("id-token-123", timedelta(days=14))]

    name, morsel = parse_set_cookie(response.headers["set-cookie"])
    assert name == "session"
    assert morsel.value == "fake-session-cookie"

    user = await session.scalar(select(User).where(User.firebase_uid == "uid-1"))
    assert user is not None
    assert (user.email, user.display_name) == ("ana@example.com", "Ana Pérez")
    space = await session.scalar(select(Space).where(Space.created_by == user.id))
    assert space is not None
    assert (space.name, space.type, space.currency) == ("Mi espacio", "personal", "UYU")
    assert space.timezone == "America/Montevideo"
    member = await session.scalar(select(SpaceMember).where(SpaceMember.space_id == space.id))
    assert member is not None
    assert (member.user_id, member.role) == (user.id, "owner")


async def test_local_cookie_is_httponly_lax_not_secure_and_lasts_fourteen_days(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth
) -> None:
    response = await api_client.post(URL, json=BODY, headers={"Origin": LOCAL_ORIGIN})

    _, morsel = parse_set_cookie(response.headers["set-cookie"])
    assert bool(morsel["httponly"]) is True
    assert bool(morsel["secure"]) is False
    assert morsel["samesite"].lower() == "lax"
    assert morsel["path"] == "/"
    assert morsel["max-age"] == str(14 * 24 * 3600)
    assert morsel["domain"] == ""


@pytest.mark.parametrize("env", ["staging", "prod"])
async def test_cookie_is_host_prefixed_and_secure_outside_local(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    staging: Callable[..., Settings],
    env: str,
) -> None:
    staging(env)

    response = await api_client.post(URL, json=BODY, headers={"Origin": STAGING_ORIGIN})

    assert response.status_code == 204
    name, morsel = parse_set_cookie(response.headers["set-cookie"])
    assert name == "__Host-session"
    assert bool(morsel["secure"]) is True
    assert bool(morsel["httponly"]) is True
    assert morsel["samesite"].lower() == "lax"
    assert morsel["path"] == "/"
    assert morsel["domain"] == ""


async def test_a_second_login_is_idempotent_and_keeps_the_first_timezone(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    await api_client.post(URL, json=BODY, headers={"Origin": LOCAL_ORIGIN})
    fake_firebase.identity = make_identity(email="ana.new@example.com", name="Other Name")

    response = await api_client.post(
        URL, json={**BODY, "timezone": "Asia/Tokyo"}, headers={"Origin": LOCAL_ORIGIN}
    )

    assert response.status_code == 204
    assert await _snapshot(session) == (1, 1, 1)
    user = await session.scalar(select(User))
    assert user is not None
    assert (user.email, user.display_name) == ("ana.new@example.com", "Ana Pérez")
    space = await session.scalar(select(Space))
    assert space is not None
    assert space.timezone == "America/Montevideo"


async def test_two_users_get_separate_personal_spaces(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    await api_client.post(URL, json=BODY, headers={"Origin": LOCAL_ORIGIN})
    fake_firebase.identity = make_identity(uid="uid-2", email="bea@example.com", name=None)
    await api_client.post(URL, json=BODY, headers={"Origin": LOCAL_ORIGIN})

    assert await _snapshot(session) == (2, 2, 2)
    rows = (
        await session.execute(
            select(User.firebase_uid, SpaceMember.space_id)
            .join(SpaceMember, SpaceMember.user_id == User.id)
            .order_by(User.firebase_uid)
        )
    ).all()
    assert [uid for uid, _ in rows] == ["uid-1", "uid-2"]
    assert rows[0][1] != rows[1][1]


# --- Origin (403) ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "origin",
    [
        "https://evil.example.com",
        "http://localhost:3001",
        "https://localhost:3000",
        "http://localhost:3000/",
        "null",
        "",
    ],
)
async def test_a_disallowed_origin_is_a_403_and_does_nothing(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    origin: str,
) -> None:
    response = await api_client.post(URL, json=BODY, headers={"Origin": origin})

    assert response.status_code == 403
    assert response.json()["code"] == "origin_not_allowed"
    assert set(response.json()) == {"detail", "code"}
    assert "set-cookie" not in response.headers
    assert not fake_firebase.called
    assert await _snapshot(session) == (0, 0, 0)


async def test_a_missing_origin_is_a_403(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    response = await api_client.post(URL, json=BODY)

    assert response.status_code == 403
    assert response.json()["code"] == "origin_not_allowed"
    assert not fake_firebase.called
    assert await _snapshot(session) == (0, 0, 0)


async def test_the_origin_is_checked_before_the_body(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth
) -> None:
    response = await api_client.post(
        URL,
        json={**BODY, "timezone": "Mars/Olympus"},
        headers={"Origin": "https://evil.example.com"},
    )

    assert response.status_code == 403


async def test_the_staging_origin_is_the_only_one_allowed_there(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, staging: Callable[..., Settings]
) -> None:
    staging()

    local = await api_client.post(URL, json=BODY, headers={"Origin": LOCAL_ORIGIN})
    allowed = await api_client.post(URL, json=BODY, headers={"Origin": STAGING_ORIGIN})

    assert local.status_code == 403
    assert allowed.status_code == 204


async def test_the_origin_match_ignores_case(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth
) -> None:
    response = await api_client.post(URL, json=BODY, headers={"Origin": "HTTP://LOCALHOST:3000"})

    assert response.status_code == 204


# --- Invalid or old token (401) -------------------------------------------------------------


async def test_an_invalid_token_is_a_401_without_cookie_or_rows(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    fake_firebase.verify_error = UnauthenticatedError("invalid_id_token", "Invalid ID token")

    response = await api_client.post(URL, json=BODY, headers={"Origin": LOCAL_ORIGIN})

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid ID token", "code": "invalid_id_token"}
    assert "set-cookie" not in response.headers
    assert fake_firebase.cookie_requests == []
    assert await _snapshot(session) == (0, 0, 0)


@pytest.mark.parametrize("age", [timedelta(minutes=5), timedelta(minutes=10), timedelta(days=2)])
async def test_an_old_sign_in_is_a_401_without_cookie_or_rows(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    age: timedelta,
) -> None:
    fake_firebase.identity = make_identity(auth_age=age)

    response = await api_client.post(URL, json=BODY, headers={"Origin": LOCAL_ORIGIN})

    assert response.status_code == 401
    assert response.json()["code"] == "recent_sign_in_required"
    assert "set-cookie" not in response.headers
    assert fake_firebase.cookie_requests == []
    assert await _snapshot(session) == (0, 0, 0)


@pytest.mark.parametrize("email", [None, ""])
async def test_an_account_without_email_is_a_401_email_required(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    email: str | None,
) -> None:
    fake_firebase.identity = make_identity(email=email)

    response = await api_client.post(URL, json=BODY, headers={"Origin": LOCAL_ORIGIN})

    assert response.status_code == 401
    assert response.json() == {"detail": "The account has no email", "code": "email_required"}
    assert "set-cookie" not in response.headers
    assert fake_firebase.cookie_requests == []
    assert await _snapshot(session) == (0, 0, 0)


async def test_a_token_that_expires_while_creating_the_cookie_is_a_401(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    fake_firebase.cookie_error = UnauthenticatedError("invalid_id_token", "Invalid ID token")

    response = await api_client.post(URL, json=BODY, headers={"Origin": LOCAL_ORIGIN})

    assert response.status_code == 401
    assert await _snapshot(session) == (0, 0, 0)


# --- Validation (422) -----------------------------------------------------------------------


@pytest.mark.parametrize("timezone", ["Mars/Olympus", "", "america/montevideo", "../etc/passwd"])
async def test_an_invalid_timezone_is_a_422_before_calling_firebase(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, timezone: str
) -> None:
    response = await api_client.post(
        URL, json={**BODY, "timezone": timezone}, headers={"Origin": LOCAL_ORIGIN}
    )

    assert response.status_code == 422
    [entry] = response.json()["detail"]
    assert entry["loc"] == ["body", "timezone"]
    assert entry["type"] == "timezone_invalid"
    assert not fake_firebase.called
    assert await _snapshot(session) == (0, 0, 0)


@pytest.mark.parametrize(
    "body",
    [
        {"timezone": "UTC"},
        {"id_token": "tok"},
        {"id_token": "", "timezone": "UTC"},
        {"id_token": "tok", "timezone": "UTC", "extra": 1},
        {"id_token": 5, "timezone": "UTC"},
    ],
)
async def test_an_invalid_body_is_a_422(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, body: dict[str, object]
) -> None:
    response = await api_client.post(URL, json=body, headers={"Origin": LOCAL_ORIGIN})

    assert response.status_code == 422
    assert not fake_firebase.called


# --- Unexpected failures and the transaction ------------------------------------------------


async def test_a_firebase_failure_creating_the_cookie_is_a_generic_500(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    fake_firebase.cookie_error = RuntimeError(
        "identitytoolkit said: PERMISSION_DENIED secret-detail"
    )

    response = await api_client.post(URL, json=BODY, headers={"Origin": LOCAL_ORIGIN})

    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error", "code": "internal_error"}
    assert "secret-detail" not in response.text
    assert "set-cookie" not in response.headers
    assert await _snapshot(session) == (0, 0, 0)


async def test_user_and_space_are_one_transaction_and_no_cookie_leaves_on_failure(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def failing_space(*_args: object, **_kwargs: object) -> bool:
        raise RuntimeError("space insert failed")

    monkeypatch.setattr(spaces_service, "ensure_personal_space", failing_space)

    response = await api_client.post(URL, json=BODY, headers={"Origin": LOCAL_ORIGIN})

    assert response.status_code == 500
    assert "set-cookie" not in response.headers
    assert await _snapshot(session) == (0, 0, 0)  # the user upsert was rolled back too


# --- Logs -----------------------------------------------------------------------------------


async def test_logs_never_carry_the_token_the_cookie_or_the_email(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, log_stream: io.StringIO
) -> None:
    await api_client.post(URL, json=BODY, headers={"Origin": LOCAL_ORIGIN})
    fake_firebase.identity = make_identity(auth_age=timedelta(hours=1))
    await api_client.post(URL, json=BODY, headers={"Origin": LOCAL_ORIGIN})

    output = log_stream.getvalue()
    lines = [json.loads(line) for line in output.splitlines()]
    assert "session_created" in {line["message"] for line in lines}
    assert "id-token-123" not in output
    assert "fake-session-cookie" not in output
    assert "ana@example.com" not in output


# --- DELETE ---------------------------------------------------------------------------------


async def test_logout_clears_the_cookie_with_204(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth
) -> None:
    response: Response = await api_client.delete(URL, headers={"Origin": LOCAL_ORIGIN})

    assert response.status_code == 204
    assert response.content == b""
    name, morsel = parse_set_cookie(response.headers["set-cookie"])
    assert name == "session"
    assert morsel.value == ""
    assert morsel["max-age"] == "0"
    assert morsel["path"] == "/"
    assert not fake_firebase.called


@pytest.mark.parametrize("env", ["staging", "prod"])
async def test_logout_clears_the_host_prefixed_cookie_with_the_secure_flag(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    staging: Callable[..., Settings],
    env: str,
) -> None:
    staging(env)

    response = await api_client.delete(URL, headers={"Origin": STAGING_ORIGIN})

    assert response.status_code == 204
    name, morsel = parse_set_cookie(response.headers["set-cookie"])
    assert name == "__Host-session"
    assert morsel["max-age"] == "0"
    assert bool(morsel["secure"]) is True
    assert morsel["path"] == "/"
    assert morsel["domain"] == ""


async def test_logout_works_with_a_session_cookie_present(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth
) -> None:
    api_client.cookies.set("session", "whatever", domain="test")

    response = await api_client.delete(URL, headers={"Origin": LOCAL_ORIGIN})

    assert response.status_code == 204


async def test_logout_with_a_valid_cookie_revokes_the_users_sessions_and_clears_the_cookie(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth
) -> None:
    fake_firebase.session_identity = make_identity(uid="uid-42")

    response = await api_client.delete(
        URL, headers={"Origin": LOCAL_ORIGIN, "Cookie": "session=the-cookie"}
    )

    assert response.status_code == 204
    assert response.content == b""
    assert fake_firebase.verified_cookies == ["the-cookie"]
    assert fake_firebase.revoked_uids == ["uid-42"]  # the uid of the verified cookie, nothing else
    name, morsel = parse_set_cookie(response.headers["set-cookie"])
    assert (name, morsel.value, morsel["max-age"]) == ("session", "", "0")


@pytest.mark.parametrize("env", ["staging", "prod"])
async def test_logout_reads_the_host_prefixed_cookie_outside_local(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    staging: Callable[..., Settings],
    env: str,
) -> None:
    staging(env)

    response = await api_client.delete(
        URL, headers={"Origin": STAGING_ORIGIN, "Cookie": "__Host-session=the-cookie"}
    )

    assert response.status_code == 204
    assert fake_firebase.verified_cookies == ["the-cookie"]
    assert fake_firebase.revoked_uids == ["uid-1"]
    assert parse_set_cookie(response.headers["set-cookie"])[0] == "__Host-session"


async def test_logout_ignores_the_cookie_of_another_environment(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, staging: Callable[..., Settings]
) -> None:
    staging()

    response = await api_client.delete(
        URL, headers={"Origin": STAGING_ORIGIN, "Cookie": "session=not-ours"}
    )

    assert response.status_code == 204
    assert not fake_firebase.called


async def test_logout_with_an_invalid_cookie_is_204_clears_the_cookie_and_revokes_nothing(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth
) -> None:
    fake_firebase.session_error = UnauthenticatedError("invalid_session", "Invalid session")

    response = await api_client.delete(
        URL, headers={"Origin": LOCAL_ORIGIN, "Cookie": "session=expired-or-revoked"}
    )

    assert response.status_code == 204
    assert fake_firebase.verified_cookies == ["expired-or-revoked"]
    assert fake_firebase.revoked_uids == []
    name, morsel = parse_set_cookie(response.headers["set-cookie"])
    assert (name, morsel.value, morsel["max-age"]) == ("session", "", "0")


@pytest.mark.parametrize("failing_step", ["verify", "revoke"])
async def test_logout_when_firebase_fails_is_204_clears_the_cookie_and_logs_an_error(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    log_stream: io.StringIO,
    failing_step: str,
) -> None:
    failure = RuntimeError("identitytoolkit said: PERMISSION_DENIED secret-detail")
    if failing_step == "verify":
        fake_firebase.session_error = failure
    else:
        fake_firebase.revoke_error = failure

    response = await api_client.delete(
        URL, headers={"Origin": LOCAL_ORIGIN, "Cookie": "session=secret-cookie"}
    )

    assert response.status_code == 204
    assert response.content == b""
    name, morsel = parse_set_cookie(response.headers["set-cookie"])
    assert (name, morsel.value, morsel["max-age"]) == ("session", "", "0")
    lines = [json.loads(line) for line in log_stream.getvalue().splitlines()]
    [event] = [line for line in lines if line["message"] == "session_revocation_failed"]
    assert event["severity"] == "ERROR"
    assert event["firebase_error"] == "RuntimeError"
    assert "secret-detail" not in log_stream.getvalue()
    assert "secret-cookie" not in log_stream.getvalue()


@pytest.mark.parametrize("origin", [None, "https://evil.example.com", "null"])
async def test_a_cross_origin_logout_with_a_valid_cookie_is_403_and_revokes_nothing(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, origin: str | None
) -> None:
    headers = {"Cookie": "session=the-cookie"}
    if origin is not None:
        headers["Origin"] = origin

    response = await api_client.delete(URL, headers=headers)

    assert response.status_code == 403
    assert response.json()["code"] == "origin_not_allowed"
    assert "set-cookie" not in response.headers
    assert not fake_firebase.called


@pytest.mark.parametrize("origin", [None, "https://evil.example.com", "null"])
async def test_logout_from_a_disallowed_origin_is_a_403(
    api_client: AsyncClient, origin: str | None
) -> None:
    headers = {} if origin is None else {"Origin": origin}

    response = await api_client.delete(URL, headers=headers)

    assert response.status_code == 403
    assert response.json()["code"] == "origin_not_allowed"
    assert "set-cookie" not in response.headers


# --- Contract -------------------------------------------------------------------------------


def test_the_routes_are_in_the_openapi_without_a_trailing_slash(app: FastAPI) -> None:
    paths = app.openapi()["paths"]

    assert set(paths[URL]) == {"post", "delete"}
    assert paths[URL]["post"]["responses"]["204"]
    assert paths[URL]["delete"]["responses"]["204"]
    for status in ("401", "403", "422"):
        assert status in paths[URL]["post"]["responses"]
    assert "403" in paths[URL]["delete"]["responses"]


def test_logout_documents_no_validation_error_and_no_origin_parameter(app: FastAPI) -> None:
    # The Origin check is a plain dependency on the request: it must not add a header parameter
    # (which makes FastAPI document a 422 that can never happen) to either operation.
    operations = app.openapi()["paths"][URL]

    assert "422" not in operations["delete"]["responses"]
    assert "parameters" not in operations["delete"]
    assert "parameters" not in operations["post"]
    assert "422" in operations["post"]["responses"]  # the body can still be invalid

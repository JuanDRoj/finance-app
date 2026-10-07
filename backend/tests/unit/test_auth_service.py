import asyncio
import io
import json
from datetime import UTC, datetime, timedelta

import pytest

from app.core.errors import UnauthenticatedError
from app.modules.auth import service
from tests.fakes import FakeFirebaseAuth, make_identity

NOW = datetime(2026, 10, 5, 12, 0, tzinfo=UTC)


def _firebase_signed_in(
    ago: timedelta | None, *, email: str | None = "ana@example.com"
) -> FakeFirebaseAuth:
    firebase = FakeFirebaseAuth()
    firebase.identity = make_identity(auth_age=ago, now=NOW, email=email)
    return firebase


async def test_a_recent_sign_in_creates_the_session_cookie() -> None:
    firebase = _firebase_signed_in(timedelta(seconds=30))

    new = await service.create_session(firebase, "tok", now=NOW)

    assert new.cookie == "fake-session-cookie"
    assert new.firebase_uid == "uid-1"
    assert new.email == "ana@example.com"
    assert new.display_name == "Ana Pérez"


async def test_the_cookie_lasts_fourteen_days() -> None:
    firebase = _firebase_signed_in(timedelta(seconds=1))

    await service.create_session(firebase, "tok-123", now=NOW)

    assert firebase.cookie_requests == [("tok-123", timedelta(days=14))]


async def test_a_sign_in_just_under_five_minutes_old_is_accepted() -> None:
    firebase = _firebase_signed_in(timedelta(minutes=4, seconds=59))

    await service.create_session(firebase, "tok", now=NOW)

    assert len(firebase.cookie_requests) == 1


@pytest.mark.parametrize(
    "age", [timedelta(minutes=5), timedelta(minutes=5, seconds=1), timedelta(days=3)]
)
async def test_a_sign_in_of_five_minutes_or_more_needs_a_fresh_one(age: timedelta) -> None:
    firebase = _firebase_signed_in(age)

    with pytest.raises(UnauthenticatedError) as exc:
        await service.create_session(firebase, "tok", now=NOW)

    assert exc.value.code == "recent_sign_in_required"
    assert firebase.cookie_requests == []


async def test_a_token_without_auth_time_is_invalid() -> None:
    firebase = _firebase_signed_in(None)

    with pytest.raises(UnauthenticatedError) as exc:
        await service.create_session(firebase, "tok", now=NOW)

    assert exc.value.code == "invalid_id_token"
    assert firebase.cookie_requests == []


@pytest.mark.parametrize("email", [None, ""])
async def test_a_token_without_email_has_its_own_error_code(email: str | None) -> None:
    firebase = _firebase_signed_in(timedelta(seconds=1), email=email)

    with pytest.raises(UnauthenticatedError) as exc:
        await service.create_session(firebase, "tok", now=NOW)

    assert exc.value.code == "email_required"
    assert exc.value.detail == "The account has no email"
    assert firebase.cookie_requests == []


async def test_a_token_without_auth_time_and_email_is_still_invalid_id_token() -> None:
    firebase = _firebase_signed_in(None, email=None)

    with pytest.raises(UnauthenticatedError) as exc:
        await service.create_session(firebase, "tok", now=NOW)

    assert exc.value.code == "invalid_id_token"


async def test_a_missing_email_is_logged_with_its_reason_and_no_personal_data(
    log_stream: io.StringIO,
) -> None:
    firebase = _firebase_signed_in(timedelta(seconds=1), email=None)

    with pytest.raises(UnauthenticatedError):
        await service.create_session(firebase, "secret-token-value", now=NOW)

    lines = [json.loads(line) for line in log_stream.getvalue().splitlines()]
    rejected = [line for line in lines if line["message"] == "session_rejected"]
    assert [line["reason"] for line in rejected] == ["email_required"]
    assert "secret-token-value" not in log_stream.getvalue()


async def test_an_invalid_token_never_reaches_the_cookie_step() -> None:
    firebase = _firebase_signed_in(timedelta(seconds=1))
    firebase.verify_error = UnauthenticatedError("invalid_id_token", "Invalid ID token")

    with pytest.raises(UnauthenticatedError) as exc:
        await service.create_session(firebase, "tok", now=NOW)

    assert exc.value.code == "invalid_id_token"
    assert firebase.cookie_requests == []


async def test_a_rejected_sign_in_is_logged_without_the_token_or_the_email(
    log_stream: io.StringIO,
) -> None:
    firebase = _firebase_signed_in(timedelta(hours=1))

    with pytest.raises(UnauthenticatedError):
        await service.create_session(firebase, "secret-token-value", now=NOW)

    lines = [json.loads(line) for line in log_stream.getvalue().splitlines()]
    rejected = [line for line in lines if line["message"] == "session_rejected"]
    assert len(rejected) == 1
    assert rejected[0]["reason"] == "recent_sign_in_required"
    assert "secret-token-value" not in log_stream.getvalue()
    assert "ana@example.com" not in log_stream.getvalue()


# --- end_session (logout) --------------------------------------------------------------------


def _events(log_stream: io.StringIO, message: str) -> list[dict[str, object]]:
    lines = [json.loads(line) for line in log_stream.getvalue().splitlines()]
    return [line for line in lines if line["message"] == message]


async def test_ending_a_valid_session_revokes_the_uid_of_the_verified_cookie() -> None:
    firebase = FakeFirebaseAuth()
    firebase.session_identity = make_identity(uid="uid-42")

    outcome = await service.end_session(firebase, "the-cookie")

    assert outcome == "revoked"
    assert firebase.verified_cookies == ["the-cookie"]
    assert firebase.revoked_uids == ["uid-42"]


@pytest.mark.parametrize("cookie", [None, ""])
async def test_ending_without_a_cookie_does_not_call_firebase(cookie: str | None) -> None:
    firebase = FakeFirebaseAuth()

    outcome = await service.end_session(firebase, cookie)

    assert outcome == "no_session"
    assert not firebase.called


async def test_ending_an_invalid_session_revokes_nothing_and_does_not_raise() -> None:
    firebase = FakeFirebaseAuth()
    firebase.session_error = UnauthenticatedError("invalid_session", "Invalid session")

    outcome = await service.end_session(firebase, "stale-cookie")

    assert outcome == "no_session"
    assert firebase.verified_cookies == ["stale-cookie"]
    assert firebase.revoked_uids == []


async def test_a_failure_verifying_the_cookie_is_logged_as_error_and_not_raised(
    log_stream: io.StringIO,
) -> None:
    firebase = FakeFirebaseAuth()
    firebase.session_error = ConnectionError("certificates unreachable")

    outcome = await service.end_session(firebase, "the-cookie")

    assert outcome == "revocation_failed"
    assert firebase.revoked_uids == []
    [event] = _events(log_stream, "session_revocation_failed")
    assert event["severity"] == "ERROR"
    assert event["firebase_error"] == "ConnectionError"
    assert "firebase_uid" not in event  # the account is not known yet


async def test_a_failure_revoking_is_logged_as_error_with_the_uid_and_not_raised(
    log_stream: io.StringIO,
) -> None:
    firebase = FakeFirebaseAuth()
    firebase.session_identity = make_identity(uid="uid-42")
    firebase.revoke_error = PermissionError("caller lacks permission")

    outcome = await service.end_session(firebase, "the-cookie")

    assert outcome == "revocation_failed"
    [event] = _events(log_stream, "session_revocation_failed")
    assert event["severity"] == "ERROR"
    assert event["firebase_error"] == "PermissionError"
    assert event["firebase_uid"] == "uid-42"


async def test_a_cancelled_logout_is_not_swallowed(monkeypatch: pytest.MonkeyPatch) -> None:
    firebase = FakeFirebaseAuth()

    async def cancelled(_cookie: str) -> None:
        raise asyncio.CancelledError

    monkeypatch.setattr(firebase, "verify_session_cookie", cancelled)

    with pytest.raises(asyncio.CancelledError):
        await service.end_session(firebase, "the-cookie")


async def test_logs_of_ending_a_session_never_carry_the_cookie_or_the_error_text(
    log_stream: io.StringIO,
) -> None:
    ok = FakeFirebaseAuth()
    await service.end_session(ok, "secret-cookie-value")
    failing = FakeFirebaseAuth()
    failing.revoke_error = RuntimeError("secret-cookie-value quoted by Firebase")
    await service.end_session(failing, "secret-cookie-value")
    rejected = FakeFirebaseAuth()
    rejected.session_error = UnauthenticatedError("invalid_session", "Invalid session")
    await service.end_session(rejected, "secret-cookie-value")

    output = log_stream.getvalue()
    messages = [json.loads(line)["message"] for line in output.splitlines()]
    assert messages == ["session_revoked", "session_revocation_failed"]
    assert "secret-cookie-value" not in output
    assert "ana@example.com" not in output

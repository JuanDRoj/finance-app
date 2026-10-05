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
async def test_a_token_without_email_is_invalid(email: str | None) -> None:
    firebase = _firebase_signed_in(timedelta(seconds=1), email=email)

    with pytest.raises(UnauthenticatedError) as exc:
        await service.create_session(firebase, "tok", now=NOW)

    assert exc.value.code == "invalid_id_token"
    assert firebase.cookie_requests == []


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

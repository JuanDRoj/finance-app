"""The real adapter over firebase-admin, in emulator mode so that it needs no network.

Unsigned tokens (see `tests.fakes.unsigned_id_token`) let each test choose its own claims.
`create_firebase_auth` writes FIREBASE_AUTH_EMULATOR_HOST into os.environ; every test first sets
the variable through `monkeypatch` so that its original (absent) state is restored afterwards.
"""

import os
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import firebase_admin
import pytest
from firebase_admin import auth
from firebase_admin.exceptions import InternalError

from app.core.config import Settings
from app.core.errors import UnauthenticatedError
from app.modules.auth.firebase import FirebaseAdminAuth, create_firebase_auth
from tests.fakes import unsigned_id_token

ENV_VAR = "FIREBASE_AUTH_EMULATOR_HOST"


@pytest.fixture
def adapter(monkeypatch: pytest.MonkeyPatch) -> Iterator[FirebaseAdminAuth]:
    monkeypatch.setenv(ENV_VAR, "localhost:9099")
    instance = create_firebase_auth(Settings(_env_file=None))
    try:
        yield instance
    finally:
        instance.close()


async def test_a_valid_token_is_normalised_into_an_identity(adapter: FirebaseAdminAuth) -> None:
    token = unsigned_id_token(
        sub="uid-9", email="ana@example.com", name="Ana", auth_time=1_700_000_000
    )

    identity = await adapter.verify_id_token(token)

    assert identity.uid == "uid-9"
    assert identity.email == "ana@example.com"
    assert identity.name == "Ana"
    assert identity.auth_time == datetime(2023, 11, 14, 22, 13, 20, tzinfo=UTC)


async def test_optional_claims_come_back_as_none(adapter: FirebaseAdminAuth) -> None:
    identity = await adapter.verify_id_token(
        unsigned_id_token(email=None, name=None, auth_time=None)
    )

    assert (identity.email, identity.name, identity.auth_time) == (None, None, None)


@pytest.mark.parametrize(
    "token",
    [
        "",
        "not-a-jwt",
        unsigned_id_token(aud="another-project"),
        unsigned_id_token(iss="https://securetoken.google.com/another-project"),
        unsigned_id_token(sub=""),
    ],
    ids=["empty", "garbage", "wrong-audience", "wrong-issuer", "empty-subject"],
)
async def test_an_invalid_token_is_a_401_with_a_stable_code(
    adapter: FirebaseAdminAuth, token: str
) -> None:
    with pytest.raises(UnauthenticatedError) as exc:
        await adapter.verify_id_token(token)

    assert exc.value.code == "invalid_id_token"
    assert token == "" or token not in exc.value.detail  # the token is never echoed


@pytest.mark.parametrize(
    "error",
    [
        auth.ExpiredIdTokenError("expired", cause=None),
        auth.RevokedIdTokenError("revoked"),
        auth.InvalidIdTokenError("invalid"),
        auth.UserDisabledError("disabled"),
    ],
    ids=["expired", "revoked", "invalid", "disabled"],
)
async def test_firebase_token_errors_are_a_401(
    adapter: FirebaseAdminAuth, monkeypatch: pytest.MonkeyPatch, error: Exception
) -> None:
    def fail(*_args: Any, **_kwargs: Any) -> None:
        raise error

    monkeypatch.setattr(auth, "verify_id_token", fail)

    with pytest.raises(UnauthenticatedError) as exc:
        await adapter.verify_id_token("tok")

    assert exc.value.code == "invalid_id_token"


async def test_a_failure_to_fetch_the_google_certificates_is_not_a_401(
    adapter: FirebaseAdminAuth, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail(*_args: Any, **_kwargs: Any) -> None:
        raise auth.CertificateFetchError("network down", cause=None)

    monkeypatch.setattr(auth, "verify_id_token", fail)

    with pytest.raises(auth.CertificateFetchError):
        await adapter.verify_id_token("tok")


async def test_the_session_cookie_is_requested_for_this_app(
    adapter: FirebaseAdminAuth, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: dict[str, Any] = {}

    def create(id_token: str, expires_in: timedelta, app: Any = None) -> bytes:
        seen.update(id_token=id_token, expires_in=expires_in, app=app)
        return b"cookie-bytes"

    monkeypatch.setattr(auth, "create_session_cookie", create)

    cookie = await adapter.create_session_cookie("tok", timedelta(days=14))

    assert cookie == "cookie-bytes"
    assert seen == {"id_token": "tok", "expires_in": timedelta(days=14), "app": adapter.app}


async def test_a_token_rejected_when_creating_the_cookie_is_a_401(
    adapter: FirebaseAdminAuth, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail(*_args: Any, **_kwargs: Any) -> None:
        raise auth.InvalidIdTokenError("Invalid ID token")

    monkeypatch.setattr(auth, "create_session_cookie", fail)

    with pytest.raises(UnauthenticatedError) as exc:
        await adapter.create_session_cookie("tok", timedelta(days=14))

    assert exc.value.code == "invalid_id_token"


async def test_any_other_firebase_failure_while_creating_the_cookie_is_not_a_401(
    adapter: FirebaseAdminAuth, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail(*_args: Any, **_kwargs: Any) -> None:
        raise InternalError("Firebase is down")

    monkeypatch.setattr(auth, "create_session_cookie", fail)

    with pytest.raises(InternalError):
        await adapter.create_session_cookie("tok", timedelta(days=14))


def test_the_emulator_host_of_the_settings_reaches_firebase_admin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Settings may read the host from backend/.env, which never reaches os.environ by itself, and
    # firebase-admin only looks at os.environ.
    monkeypatch.setenv(ENV_VAR, "placeholder")
    monkeypatch.delenv(ENV_VAR)
    settings = Settings(_env_file=None, FIREBASE_AUTH_EMULATOR_HOST="localhost:9099")

    instance = create_firebase_auth(settings)
    try:
        assert os.environ[ENV_VAR] == "localhost:9099"
    finally:
        instance.close()


@pytest.mark.parametrize("host", ["", " "])
def test_the_variable_is_removed_when_the_settings_have_no_emulator(
    monkeypatch: pytest.MonkeyPatch, host: str
) -> None:
    # os.environ must always agree with Settings: a stale value would turn the emulator on
    # (firebase-admin trusts any non-empty value and then skips the signature check).
    monkeypatch.setenv(ENV_VAR, "localhost:9099")
    settings = Settings(_env_file=None, FIREBASE_AUTH_EMULATOR_HOST=host)
    assert settings.FIREBASE_AUTH_EMULATOR_HOST is None

    instance = create_firebase_auth(settings)
    try:
        assert ENV_VAR not in os.environ
    finally:
        instance.close()


def test_removing_the_variable_is_fine_when_it_was_never_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(ENV_VAR, "placeholder")  # so monkeypatch restores the absent state
    monkeypatch.delenv(ENV_VAR)
    instance = create_firebase_auth(Settings(_env_file=None, FIREBASE_AUTH_EMULATOR_HOST=""))
    try:
        assert ENV_VAR not in os.environ
    finally:
        instance.close()


def test_the_app_uses_the_configured_project_and_close_releases_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(ENV_VAR, "localhost:9099")
    instance = create_firebase_auth(Settings(_env_file=None, FIREBASE_PROJECT_ID="demo-other"))

    assert instance.app.project_id == "demo-other"
    instance.close()
    with pytest.raises(ValueError, match="does not exist"):
        firebase_admin.get_app(instance.app.name)


def test_two_adapters_can_coexist_without_the_default_app(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(ENV_VAR, "localhost:9099")
    first = create_firebase_auth(Settings(_env_file=None))
    second = create_firebase_auth(Settings(_env_file=None))
    try:
        assert first.app.name != second.app.name
    finally:
        first.close()
        second.close()


async def test_the_session_cookie_is_verified_with_revocation_check_for_this_app(
    adapter: FirebaseAdminAuth, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: dict[str, Any] = {}

    def verify(
        cookie: str, check_revoked: bool = False, app: Any = None, **_kw: Any
    ) -> dict[str, Any]:
        seen.update(cookie=cookie, check_revoked=check_revoked, app=app)
        return {
            "uid": "uid-7",
            "email": "ana@example.com",
            "name": "Ana",
            "auth_time": 1_700_000_000,
        }

    monkeypatch.setattr(auth, "verify_session_cookie", verify)

    identity = await adapter.verify_session_cookie("the-cookie")

    assert seen == {"cookie": "the-cookie", "check_revoked": True, "app": adapter.app}
    assert (identity.uid, identity.email) == ("uid-7", "ana@example.com")


@pytest.mark.parametrize(
    "error",
    [
        ValueError("empty"),
        auth.InvalidSessionCookieError("invalid"),
        auth.ExpiredSessionCookieError("expired", cause=None),
        auth.RevokedSessionCookieError("revoked"),
        auth.UserDisabledError("disabled"),
        auth.UserNotFoundError("gone"),
    ],
    ids=["value-error", "invalid", "expired", "revoked", "disabled", "user-deleted"],
)
async def test_firebase_session_cookie_errors_are_a_401(
    adapter: FirebaseAdminAuth, monkeypatch: pytest.MonkeyPatch, error: Exception
) -> None:
    def fail(*_args: Any, **_kwargs: Any) -> None:
        raise error

    monkeypatch.setattr(auth, "verify_session_cookie", fail)

    with pytest.raises(UnauthenticatedError) as exc:
        await adapter.verify_session_cookie("cookie-secret")

    assert exc.value.code == "invalid_session"
    assert "cookie-secret" not in exc.value.detail


async def test_a_malformed_session_cookie_is_a_401_without_network(
    adapter: FirebaseAdminAuth,
) -> None:
    for cookie in ("", "not-a-jwt"):
        with pytest.raises(UnauthenticatedError) as exc:
            await adapter.verify_session_cookie(cookie)
        assert exc.value.code == "invalid_session"


async def test_a_failure_to_reach_firebase_when_verifying_a_cookie_is_not_a_401(
    adapter: FirebaseAdminAuth, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail(*_args: Any, **_kwargs: Any) -> None:
        raise auth.CertificateFetchError("network down", cause=None)

    monkeypatch.setattr(auth, "verify_session_cookie", fail)

    with pytest.raises(auth.CertificateFetchError):
        await adapter.verify_session_cookie("cookie")


async def test_refresh_tokens_are_revoked_for_this_app_and_uid(
    adapter: FirebaseAdminAuth, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: dict[str, Any] = {}

    def revoke(uid: str, app: Any = None) -> None:
        seen.update(uid=uid, app=app)

    monkeypatch.setattr(auth, "revoke_refresh_tokens", revoke)

    revoked = await adapter.revoke_refresh_tokens("uid-7")

    assert revoked is True
    assert seen == {"uid": "uid-7", "app": adapter.app}


async def test_revoking_an_account_that_is_already_gone_is_not_an_error_and_says_so(
    adapter: FirebaseAdminAuth, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail(*_args: Any, **_kwargs: Any) -> None:
        raise auth.UserNotFoundError("gone")

    monkeypatch.setattr(auth, "revoke_refresh_tokens", fail)

    # Nothing to revoke: it must not raise, and it must not claim it revoked anything.
    assert await adapter.revoke_refresh_tokens("uid-gone") is False


async def test_any_other_failure_revoking_refresh_tokens_is_not_swallowed(
    adapter: FirebaseAdminAuth, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail(*_args: Any, **_kwargs: Any) -> None:
        raise InternalError("Firebase is down")

    monkeypatch.setattr(auth, "revoke_refresh_tokens", fail)

    with pytest.raises(InternalError):
        await adapter.revoke_refresh_tokens("uid-7")

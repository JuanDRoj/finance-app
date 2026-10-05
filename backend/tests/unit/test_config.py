from typing import Any

import pytest
from pydantic import ValidationError

from app.core.config import Settings

STAGING_DATABASE_URL = "postgresql+asyncpg://u:p@db.internal/finance"


def _settings() -> Settings:
    return Settings(_env_file=None)


def _set_firebase_and_origins(monkeypatch: pytest.MonkeyPatch) -> None:
    """The two variables that are also required outside local, so these tests isolate theirs."""
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "finance-staging")
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://app.example.com")


def test_env_defaults_to_local(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ENV", raising=False)
    assert _settings().ENV == "local"


def test_env_rejects_unknown_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENV", "dev")
    with pytest.raises(ValidationError):
        _settings()


def test_emulator_host_allowed_in_local(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENV", "local")
    monkeypatch.setenv("FIREBASE_AUTH_EMULATOR_HOST", "localhost:9099")
    s = _settings()
    assert s.FIREBASE_AUTH_EMULATOR_HOST == "localhost:9099"


@pytest.mark.parametrize("env", ["staging", "prod"])
def test_emulator_host_rejected_in_staging_and_prod(
    monkeypatch: pytest.MonkeyPatch, env: str
) -> None:
    monkeypatch.setenv("ENV", env)
    monkeypatch.setenv("DATABASE_URL", STAGING_DATABASE_URL)  # so only the emulator can fail
    _set_firebase_and_origins(monkeypatch)
    monkeypatch.setenv("FIREBASE_AUTH_EMULATOR_HOST", "localhost:9099")
    with pytest.raises(ValidationError):
        _settings()


def test_settings_read_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENV", "staging")
    monkeypatch.setenv("DATABASE_URL", STAGING_DATABASE_URL)  # required outside local
    _set_firebase_and_origins(monkeypatch)
    monkeypatch.setenv("LOG_LEVEL", "DEBUG")
    s = _settings()
    assert s.ENV == "staging"
    assert s.LOG_LEVEL == "DEBUG"


def test_log_level_rejects_unknown_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LOG_LEVEL", "LOUD")
    with pytest.raises(ValidationError):
        _settings()


# --- Database settings ---------------------------------------------------------------------

LOCAL_DEFAULT_URL = "postgresql+asyncpg://finance:finance_dev@localhost:5432/finance"
INSTANCE = "my-project:southamerica-east1:finance-db"


def _set_connector_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INSTANCE_CONNECTION_NAME", INSTANCE)
    monkeypatch.setenv("DB_USER", "app")
    monkeypatch.setenv("DB_PASSWORD", "s3cret-pw")
    monkeypatch.setenv("DB_NAME", "finance")


def test_database_url_defaults_to_local_dev_database_in_local() -> None:
    url = _settings().DATABASE_URL
    assert url is not None
    assert url.get_secret_value() == LOCAL_DEFAULT_URL


def test_database_url_is_read_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    custom = "postgresql+asyncpg://u:p@db.internal:5433/other"
    monkeypatch.setenv("DATABASE_URL", custom)
    url = _settings().DATABASE_URL
    assert url is not None
    assert url.get_secret_value() == custom


@pytest.mark.parametrize("scheme", ["postgresql://", "postgres://", "postgresql+psycopg://"])
def test_database_url_rejects_non_asyncpg_scheme(
    monkeypatch: pytest.MonkeyPatch, scheme: str
) -> None:
    monkeypatch.setenv("DATABASE_URL", f"{scheme}u:p@localhost/db")
    with pytest.raises(ValidationError):
        _settings()


@pytest.mark.parametrize("env", ["staging", "prod"])
def test_database_config_is_required_outside_local(
    monkeypatch: pytest.MonkeyPatch, env: str
) -> None:
    monkeypatch.setenv("ENV", env)
    _set_firebase_and_origins(monkeypatch)  # so only the database can fail
    with pytest.raises(ValidationError):
        _settings()


@pytest.mark.parametrize("env", ["staging", "prod"])
def test_explicit_database_url_is_accepted_outside_local(
    monkeypatch: pytest.MonkeyPatch, env: str
) -> None:
    monkeypatch.setenv("ENV", env)
    _set_firebase_and_origins(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", STAGING_DATABASE_URL)
    assert _settings().INSTANCE_CONNECTION_NAME is None


@pytest.mark.parametrize("env", ["staging", "prod"])
def test_connector_config_is_accepted_without_database_url(
    monkeypatch: pytest.MonkeyPatch, env: str
) -> None:
    monkeypatch.setenv("ENV", env)
    _set_firebase_and_origins(monkeypatch)
    _set_connector_env(monkeypatch)
    s = _settings()
    assert s.INSTANCE_CONNECTION_NAME == INSTANCE
    assert s.DB_IP_TYPE == "PUBLIC"
    assert s.DATABASE_URL is None


@pytest.mark.parametrize("missing", ["DB_USER", "DB_PASSWORD", "DB_NAME"])
def test_connector_requires_user_password_and_name(
    monkeypatch: pytest.MonkeyPatch, missing: str
) -> None:
    _set_connector_env(monkeypatch)
    monkeypatch.delenv(missing)
    with pytest.raises(ValidationError):
        _settings()


@pytest.mark.parametrize("empty", ["DB_USER", "DB_PASSWORD", "DB_NAME"])
def test_connector_treats_empty_user_password_and_name_as_missing(
    monkeypatch: pytest.MonkeyPatch, empty: str
) -> None:
    _set_connector_env(monkeypatch)
    monkeypatch.setenv(empty, "")
    with pytest.raises(ValidationError, match=empty):
        _settings()


@pytest.mark.parametrize("name", ["finance-db", "project:instance", "a b:c:d", "a:b:c:d:e"])
def test_instance_connection_name_rejects_bad_format(
    monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    _set_connector_env(monkeypatch)
    monkeypatch.setenv("INSTANCE_CONNECTION_NAME", name)
    with pytest.raises(ValidationError):
        _settings()


def test_db_ip_type_rejects_unknown_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DB_IP_TYPE", "INTERNET")
    with pytest.raises(ValidationError):
        _settings()


def test_pool_defaults_keep_total_connections_between_two_and_five() -> None:
    s = _settings()
    assert (s.DB_POOL_SIZE, s.DB_MAX_OVERFLOW, s.DB_POOL_TIMEOUT) == (2, 3, 30)
    assert s.DB_POOL_SIZE + s.DB_MAX_OVERFLOW == 5


def test_pool_is_configurable_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DB_POOL_SIZE", "4")
    monkeypatch.setenv("DB_MAX_OVERFLOW", "1")
    monkeypatch.setenv("DB_POOL_TIMEOUT", "7")
    s = _settings()
    assert (s.DB_POOL_SIZE, s.DB_MAX_OVERFLOW, s.DB_POOL_TIMEOUT) == (4, 1, 7)


@pytest.mark.parametrize(
    ("name", "value"),
    [("DB_POOL_SIZE", "0"), ("DB_MAX_OVERFLOW", "-1"), ("DB_POOL_TIMEOUT", "0")],
)
def test_pool_rejects_out_of_range_values(
    monkeypatch: pytest.MonkeyPatch, name: str, value: str
) -> None:
    monkeypatch.setenv(name, value)
    with pytest.raises(ValidationError):
        _settings()


def test_settings_repr_does_not_leak_database_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_connector_env(monkeypatch)
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:url-pw-123@localhost/db")
    s = _settings()
    assert "s3cret-pw" not in repr(s)
    assert "url-pw-123" not in repr(s)
    assert "s3cret-pw" not in str(s)


# --- Firebase and session settings ----------------------------------------------------------

LOCAL_EMULATOR_HOST = "localhost:9099"
STAGING_ENV = {
    "ENV": "staging",
    "DATABASE_URL": STAGING_DATABASE_URL,
    "FIREBASE_PROJECT_ID": "finance-staging",
    "ALLOWED_ORIGINS": "https://app.example.com",
}


def _staging(**overrides: str | None) -> Settings:
    values: dict[str, Any] = {**STAGING_ENV, **overrides}
    return Settings(_env_file=None, **values)


def test_emulator_host_defaults_to_the_compose_emulator_in_local() -> None:
    assert _settings().FIREBASE_AUTH_EMULATOR_HOST == LOCAL_EMULATOR_HOST


def test_an_empty_emulator_host_turns_the_emulator_off_in_local(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FIREBASE_AUTH_EMULATOR_HOST", "")
    assert _settings().FIREBASE_AUTH_EMULATOR_HOST is None


@pytest.mark.parametrize("env", ["staging", "prod"])
def test_emulator_host_has_no_default_outside_local(env: str) -> None:
    assert _staging(ENV=env).FIREBASE_AUTH_EMULATOR_HOST is None


def test_an_empty_emulator_host_is_accepted_outside_local(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FIREBASE_AUTH_EMULATOR_HOST", "")
    assert _staging().FIREBASE_AUTH_EMULATOR_HOST is None


def test_firebase_project_id_defaults_to_the_emulator_project_in_local() -> None:
    assert _settings().FIREBASE_PROJECT_ID == "demo-finance-local"


def test_firebase_project_id_is_read_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "my-project")
    assert _settings().FIREBASE_PROJECT_ID == "my-project"


def test_an_empty_firebase_project_id_falls_back_to_the_default_in_local(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "")
    assert _settings().FIREBASE_PROJECT_ID == "demo-finance-local"


@pytest.mark.parametrize("env", ["staging", "prod"])
@pytest.mark.parametrize("value", [None, "", "  "])
def test_firebase_project_id_is_required_outside_local(env: str, value: str | None) -> None:
    with pytest.raises(ValidationError, match="FIREBASE_PROJECT_ID"):
        _staging(ENV=env, FIREBASE_PROJECT_ID=value)


def test_allowed_origins_default_to_the_local_frontend() -> None:
    assert _settings().ALLOWED_ORIGINS == ["http://localhost:3000"]


def test_allowed_origins_are_read_as_a_comma_separated_list(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://a.example.com, https://b.example.com:8443 ,")
    assert _settings().ALLOWED_ORIGINS == ["https://a.example.com", "https://b.example.com:8443"]


def test_allowed_origins_are_normalised_to_lowercase() -> None:
    assert _staging(ALLOWED_ORIGINS="HTTPS://App.Example.COM").ALLOWED_ORIGINS == [
        "https://app.example.com"
    ]


@pytest.mark.parametrize("env", ["staging", "prod"])
@pytest.mark.parametrize("value", [None, "", " , "])
def test_allowed_origins_are_required_outside_local(env: str, value: str | None) -> None:
    with pytest.raises(ValidationError, match="ALLOWED_ORIGINS"):
        _staging(ENV=env, ALLOWED_ORIGINS=value)


@pytest.mark.parametrize(
    "origin",
    [
        "*",
        "null",
        "app.example.com",
        "ftp://app.example.com",
        "https://app.example.com/",
        "https://app.example.com/path",
        "https://app.example.com?x=1",
        "https://user@app.example.com",
        "https://",
    ],
)
def test_allowed_origins_must_be_bare_origins(origin: str) -> None:
    with pytest.raises(ValidationError, match="ALLOWED_ORIGINS"):
        _staging(ALLOWED_ORIGINS=origin)


def test_session_cookie_is_plain_and_not_secure_in_local() -> None:
    s = _settings()
    assert s.session_cookie_name == "session"
    assert s.session_cookie_secure is False


@pytest.mark.parametrize("env", ["staging", "prod"])
def test_session_cookie_is_host_prefixed_and_secure_outside_local(env: str) -> None:
    s = _staging(ENV=env)
    assert s.session_cookie_name == "__Host-session"
    assert s.session_cookie_secure is True

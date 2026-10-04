import pytest
from pydantic import ValidationError

from app.core.config import Settings

STAGING_DATABASE_URL = "postgresql+asyncpg://u:p@db.internal/finance"


def _settings() -> Settings:
    return Settings(_env_file=None)


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
    monkeypatch.setenv("FIREBASE_AUTH_EMULATOR_HOST", "localhost:9099")
    with pytest.raises(ValidationError):
        _settings()


def test_settings_read_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENV", "staging")
    monkeypatch.setenv("DATABASE_URL", STAGING_DATABASE_URL)  # required outside local
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
    with pytest.raises(ValidationError):
        _settings()


@pytest.mark.parametrize("env", ["staging", "prod"])
def test_explicit_database_url_is_accepted_outside_local(
    monkeypatch: pytest.MonkeyPatch, env: str
) -> None:
    monkeypatch.setenv("ENV", env)
    monkeypatch.setenv("DATABASE_URL", STAGING_DATABASE_URL)
    assert _settings().INSTANCE_CONNECTION_NAME is None


@pytest.mark.parametrize("env", ["staging", "prod"])
def test_connector_config_is_accepted_without_database_url(
    monkeypatch: pytest.MonkeyPatch, env: str
) -> None:
    monkeypatch.setenv("ENV", env)
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

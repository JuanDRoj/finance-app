import pytest
from pydantic import ValidationError

from app.core.config import Settings


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
    monkeypatch.setenv("FIREBASE_AUTH_EMULATOR_HOST", "localhost:9099")
    with pytest.raises(ValidationError):
        _settings()


def test_settings_read_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENV", "staging")
    monkeypatch.setenv("LOG_LEVEL", "DEBUG")
    s = _settings()
    assert s.ENV == "staging"
    assert s.LOG_LEVEL == "DEBUG"

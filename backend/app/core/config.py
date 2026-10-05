import os
import re
from functools import lru_cache
from typing import Annotated, Literal, Self
from urllib.parse import urlsplit

from fastapi import Depends
from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Development-only values (docker-compose.yml). Never used outside ENV=local.
LOCAL_DATABASE_URL = "postgresql+asyncpg://finance:finance_dev@localhost:5432/finance"
LOCAL_FIREBASE_EMULATOR_HOST = "localhost:9099"
# The project the compose emulator runs with (FIREBASE_EMULATOR_PROJECT_ID in the root .env).
LOCAL_FIREBASE_PROJECT_ID = "demo-finance-local"
LOCAL_ALLOWED_ORIGINS = ["http://localhost:3000"]

# project:region:instance, as printed by `gcloud sql instances describe`.
_INSTANCE_CONNECTION_NAME = re.compile(r"[^\s:]+:[^\s:]+:[^\s:]+")


def docs_enabled() -> bool:
    """Whether to serve /docs, /redoc and /openapi.json: only when ENV is exactly "local".

    Reads the process environment instead of building `Settings`, because the app is created at
    import time and `app.export_openapi` must work with no environment variables (see CLAUDE.md).
    Anything but "local" (unset counts as "local", like `Settings.ENV`) hides the docs, so an
    invalid value fails closed. The lifespan double-checks it against the real `Settings`.
    """
    return os.environ.get("ENV", "local") == "local"


def _normalise_origin(origin: str) -> str:
    """`https://App.Example.com:8443` -> lowercase, or ValueError if it is not a bare origin.

    A browser sends `Origin: scheme://host[:port]`: no path (not even a trailing slash), query,
    fragment or credentials, and never `*`. Anything else in the allowlist would never match, so
    it is rejected at startup instead of silently locking everybody out.
    """
    parts = urlsplit(origin)
    if (
        parts.scheme.lower() not in ("http", "https")
        or not parts.hostname
        or parts.path
        or parts.query
        or parts.fragment
        or parts.username is not None
        or parts.password is not None
        or origin.endswith(("?", "#"))
    ):
        raise ValueError(f"{origin!r} is not an origin like 'https://app.example.com'")
    return f"{parts.scheme.lower()}://{parts.netloc.lower()}"


def _is_blank(value: str | SecretStr | None) -> bool:
    """None or an empty string (an empty SecretStr counts too): an unset variable in practice."""
    if isinstance(value, SecretStr):
        value = value.get_secret_value()
    return not value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ENV: Literal["local", "staging", "prod"] = "local"
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    # Only valid locally; never set it in staging/prod. In local it defaults to the compose
    # emulator; an empty value turns it off (to use a real Firebase project).
    FIREBASE_AUTH_EMULATOR_HOST: str | None = None
    # Project the ID tokens were issued for. Local: the emulator's `demo-` project; required
    # otherwise. firebase-admin takes it from here, never from the environment.
    FIREBASE_PROJECT_ID: str | None = None
    # Origins allowed to create or end a session (the frontend: the browser only talks to it,
    # `/api/*` is rewritten to this backend). Comma-separated in the environment.
    ALLOWED_ORIGINS: Annotated[list[str], NoDecode] = Field(default_factory=list)
    # GCP project id (the standard name Google's libraries read). Cloud Run does not expose it to
    # the container, so set it on the service: it builds the `logging.googleapis.com/trace` log
    # field. Optional: without it the logs just carry no trace.
    GOOGLE_CLOUD_PROJECT: str | None = None

    # --- Database -------------------------------------------------------------------------
    # Direct connection. Defaults to the local compose database when ENV=local; otherwise it
    # is required unless INSTANCE_CONNECTION_NAME is set.
    DATABASE_URL: SecretStr | None = None
    # Cloud SQL Python Connector (staging/prod). When set, it wins over DATABASE_URL.
    INSTANCE_CONNECTION_NAME: str | None = None
    DB_USER: str | None = None
    DB_PASSWORD: SecretStr | None = None
    DB_NAME: str | None = None
    DB_IP_TYPE: Literal["PUBLIC", "PRIVATE", "PSC"] = "PUBLIC"
    # Small on purpose: 2 + 3 overflow = at most 5 connections per instance.
    DB_POOL_SIZE: int = Field(default=2, ge=1)
    DB_MAX_OVERFLOW: int = Field(default=3, ge=0)
    DB_POOL_TIMEOUT: int = Field(default=30, ge=1)

    @field_validator("FIREBASE_AUTH_EMULATOR_HOST", "FIREBASE_PROJECT_ID")
    @classmethod
    def _blank_is_unset(cls, value: str | None) -> str | None:
        return value if value is not None and value.strip() else None

    @field_validator("ALLOWED_ORIGINS", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            value = [item for item in (part.strip() for part in value.split(",")) if item]
        if isinstance(value, list):
            return [_normalise_origin(str(item)) for item in value]
        return value

    @model_validator(mode="after")
    def _emulator_only_in_local(self) -> Self:
        if self.ENV != "local" and self.FIREBASE_AUTH_EMULATOR_HOST:
            raise ValueError("FIREBASE_AUTH_EMULATOR_HOST must not be set when ENV is not 'local'")
        if self.ENV == "local" and "FIREBASE_AUTH_EMULATOR_HOST" not in self.model_fields_set:
            self.FIREBASE_AUTH_EMULATOR_HOST = LOCAL_FIREBASE_EMULATOR_HOST
        return self

    @model_validator(mode="after")
    def _firebase_and_origins(self) -> Self:
        if self.FIREBASE_PROJECT_ID is None:
            if self.ENV != "local":
                raise ValueError("FIREBASE_PROJECT_ID must be set when ENV is not 'local'")
            self.FIREBASE_PROJECT_ID = LOCAL_FIREBASE_PROJECT_ID
        if not self.ALLOWED_ORIGINS:
            if self.ENV != "local":
                raise ValueError("ALLOWED_ORIGINS must be set when ENV is not 'local'")
            self.ALLOWED_ORIGINS = list(LOCAL_ALLOWED_ORIGINS)
        return self

    @model_validator(mode="after")
    def _database_config(self) -> Self:
        if self.INSTANCE_CONNECTION_NAME is not None:
            if not _INSTANCE_CONNECTION_NAME.fullmatch(self.INSTANCE_CONNECTION_NAME):
                raise ValueError(
                    "INSTANCE_CONNECTION_NAME must look like 'project:region:instance'"
                )
            missing = [
                name
                for name in ("DB_USER", "DB_PASSWORD", "DB_NAME")
                if _is_blank(getattr(self, name))
            ]
            if missing:
                raise ValueError(
                    f"{', '.join(missing)} must be set when INSTANCE_CONNECTION_NAME is set"
                )
            return self

        if self.DATABASE_URL is None:
            if self.ENV != "local":
                raise ValueError(
                    "DATABASE_URL (or INSTANCE_CONNECTION_NAME) must be set when ENV is not 'local'"
                )
            self.DATABASE_URL = SecretStr(LOCAL_DATABASE_URL)
        return self

    @model_validator(mode="after")
    def _database_url_uses_asyncpg(self) -> Self:
        if self.DATABASE_URL is not None and not self.DATABASE_URL.get_secret_value().startswith(
            "postgresql+asyncpg://"
        ):
            raise ValueError("DATABASE_URL must start with 'postgresql+asyncpg://'")
        return self

    @property
    def session_cookie_name(self) -> str:
        """`__Host-` (Secure, Path=/, no Domain) outside local; plain in local (no https)."""
        return "session" if self.ENV == "local" else "__Host-session"

    @property
    def session_cookie_secure(self) -> bool:
        return self.ENV != "local"


@lru_cache
def get_settings() -> Settings:
    return Settings()


# For routes that need the settings; tests override `get_settings` through dependency_overrides.
SettingsDep = Annotated[Settings, Depends(get_settings)]

import re
from functools import lru_cache
from typing import Literal, Self

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Development-only database (docker-compose.yml). Never used outside ENV=local.
LOCAL_DATABASE_URL = "postgresql+asyncpg://finance:finance_dev@localhost:5432/finance"

# project:region:instance, as printed by `gcloud sql instances describe`.
_INSTANCE_CONNECTION_NAME = re.compile(r"[^\s:]+:[^\s:]+:[^\s:]+")


def _is_blank(value: str | SecretStr | None) -> bool:
    """None or an empty string (an empty SecretStr counts too): an unset variable in practice."""
    if isinstance(value, SecretStr):
        value = value.get_secret_value()
    return not value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ENV: Literal["local", "staging", "prod"] = "local"
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    # Only valid locally; never set it in staging/prod.
    FIREBASE_AUTH_EMULATOR_HOST: str | None = None

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

    @model_validator(mode="after")
    def _emulator_only_in_local(self) -> Self:
        if self.ENV != "local" and self.FIREBASE_AUTH_EMULATOR_HOST:
            raise ValueError("FIREBASE_AUTH_EMULATOR_HOST must not be set when ENV is not 'local'")
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


@lru_cache
def get_settings() -> Settings:
    return Settings()

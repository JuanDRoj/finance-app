from functools import lru_cache
from typing import Literal, Self

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ENV: Literal["local", "staging", "prod"] = "local"
    LOG_LEVEL: str = "INFO"
    # Only valid locally; never set it in staging/prod.
    FIREBASE_AUTH_EMULATOR_HOST: str | None = None

    @model_validator(mode="after")
    def _emulator_only_in_local(self) -> Self:
        if self.ENV != "local" and self.FIREBASE_AUTH_EMULATOR_HOST:
            raise ValueError("FIREBASE_AUTH_EMULATOR_HOST must not be set when ENV is not 'local'")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()

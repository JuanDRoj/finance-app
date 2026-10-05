"""Types shared by the API schemas of every module."""

from functools import lru_cache
from importlib import resources
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints
from pydantic_core import PydanticCustomError

# A money amount in the minor unit of the space's currency (ISO 4217): value x 10^exponent,
# where the exponent comes from the `currencies` table (USD 15.50 -> 1550, CLP 1500 -> 1500).
# Strict: rejects "1550", 15.0 and true. Positive: the backend applies the sign according to
# the movement type. The cap is JavaScript's Number.MAX_SAFE_INTEGER, beyond which it loses
# precision even though `bigint` could hold more.
Amount = Annotated[int, Field(strict=True, gt=0, le=2**53 - 1)]


@lru_cache
def _iana_timezones() -> frozenset[str]:
    """The IANA zone names, from the `tzdata` package: the same list on every machine.

    `zoneinfo.available_timezones()` depends on the system and includes entries such as
    `localtime`. `zoneinfo.ZoneInfo` can load every name of this list (system files first, the
    `tzdata` package as fallback), so a validated name never fails later in the cron.
    """
    return frozenset(resources.files("tzdata").joinpath("zones").read_text().split())


def _check_timezone(value: str) -> str:
    if value not in _iana_timezones():
        raise PydanticCustomError("timezone_invalid", "Invalid IANA timezone")
    return value


# An IANA name such as "America/Montevideo" (case-sensitive, as in the tz database). The error
# type `timezone_invalid` is stable: the frontend translates it.
Timezone = Annotated[str, StringConstraints(strict=True), AfterValidator(_check_timezone)]


class InputModel(BaseModel):
    """Base of every request schema (`XCreate`, `XUpdate`, filters): unknown fields give 422."""

    model_config = ConfigDict(extra="forbid")


class ReadModel(BaseModel):
    """Base of every response schema (`XRead`): can be built from an ORM object."""

    model_config = ConfigDict(from_attributes=True)

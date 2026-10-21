"""Types shared by the API schemas of every module."""

from functools import lru_cache
from importlib import resources
from types import NoneType, UnionType
from typing import Annotated, Any, Literal, TypeAliasType, Union, get_args, get_origin

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationInfo,
    field_validator,
)
from pydantic_core import PydanticCustomError

# JavaScript's Number.MAX_SAFE_INTEGER, beyond which it loses precision even though `bigint` could
# hold more: the cap of every money amount of the API (and the CHECK `ck_entries_amount_range`).
MAX_SAFE_INTEGER = 2**53 - 1

# A money amount in the minor unit of the space's currency (ISO 4217): value x 10^exponent,
# where the exponent comes from the `currencies` table (USD 15.50 -> 1550, CLP 1500 -> 1500).
# Strict: rejects "1550", 15.0 and true. Positive: the backend applies the sign according to
# the movement type. The cap is `MAX_SAFE_INTEGER`.
Amount = Annotated[int, Field(strict=True, gt=0, le=MAX_SAFE_INTEGER)]


def _check_not_zero(value: int) -> int:
    if value == 0:
        raise PydanticCustomError("amount_zero", "The amount cannot be zero")
    return value


# The only money with a sign in the API: an adjustment is a delta of the balance of an account
# (negative = the balance goes down; on a credit card, the debt goes up). Same strictness and
# the same cap as `Amount` in absolute value; zero is refused because it changes nothing.
SignedAmount = Annotated[
    int,
    Field(strict=True, ge=-MAX_SAFE_INTEGER, le=MAX_SAFE_INTEGER),
    AfterValidator(_check_not_zero),
]

# A balance as it would be read, with the sign of `balance_minor`: the initial balance of a new
# account and the real balance of a reconciliation (on a credit card, negative = you owe). Not a
# movement but a state, so zero is valid: it means "no initial balance" or "the account is at
# zero". Same strictness and the same cap as `SignedAmount`.
Balance = Annotated[int, Field(strict=True, ge=-MAX_SAFE_INTEGER, le=MAX_SAFE_INTEGER)]


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


def admits_none(annotation: object) -> bool:
    """True if a field annotation accepts None: `X | None`, `Optional[X]`, `Any`, `Literal[None]`.

    Looks through `Annotated[...]` and `type X = ...` aliases, at any depth, so
    `Annotated[Annotated[int, ...] | None, ...]` and an alias of `int | None` both count.
    """
    if annotation is None or annotation is NoneType or annotation is Any:
        return True
    if isinstance(annotation, TypeAliasType):
        return admits_none(annotation.__value__)
    origin = get_origin(annotation)
    if origin is Annotated:
        return admits_none(get_args(annotation)[0])
    if origin is Union or origin is UnionType:
        return any(admits_none(arg) for arg in get_args(annotation))
    if origin is Literal:
        return None in get_args(annotation)
    return False


def unset() -> Any:
    """Default of a PATCH field that cannot be cleared: `name: AccountName = unset()`.

    It returns `Any` on purpose: the `pydantic.mypy` plugin rejects `Field(default=None)` on a
    field whose type does not admit None. An unsent field holds `None` whatever its type says, so
    a PATCH is read only with `model_dump(exclude_unset=True)`.
    """
    return Field(default=None)


class PatchModel(InputModel):
    """Base of every PATCH body (`XUpdate`): `extra="forbid"` plus a null check per field.

    Declare each editable field as `name: Type = unset()`, **without** `| None`: an
    omitted field means "leave it as it is", and an explicit `null` is a 422 `null_not_allowed`
    on that field (`loc` is `["body", "<field>"]`). A field that can be cleared is the exception:
    declare it `Type | None = None` and it accepts null. The check reads the annotation of each
    field, so OpenAPI and the TypeScript types say the same as the validation does (`name?:
    string`, not `string | null`).

    Defaults are never validated, so an unsent field holds `None` even when its type says
    otherwise. **Read a PATCH only with `model_dump(exclude_unset=True)`**, never through loose
    attributes: that is also what tells "not sent" from "sent as null" on a nullable field.

    Never use `validate_default=True` in a `PatchModel`: the check below would then run on the
    default `None` and omitting a field would be a 422 `null_not_allowed`. A rule between fields,
    or one that depends on stored data, goes in the service (see `accounts.service.update_account`).
    """

    @field_validator("*", mode="before")
    @classmethod
    def _reject_null_on_non_nullable_fields(cls, value: object, info: ValidationInfo) -> object:
        # Runs only for the fields that were sent. `info.field_name` is always set for a field
        # validator.
        if value is None and not admits_none(cls.model_fields[str(info.field_name)].annotation):
            raise PydanticCustomError("null_not_allowed", "This field cannot be null")
        return value

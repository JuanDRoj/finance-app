import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, ValidationInfo, field_validator
from pydantic_core import PydanticCustomError

from app.core.schemas import InputModel, ReadModel

AccountType = Literal["bank", "cash", "credit_card"]

# Trimmed before the length check, so a name of only spaces is as empty as "". The 80 is also a
# CHECK in the database (`ck_accounts_name_length`).
AccountName = Annotated[
    str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=80)
]

# A day of the month. Only credit cards have them (`ck_accounts_card_days`). Strict: rejects "5",
# 5.0 and true.
MonthDay = Annotated[int, Field(strict=True, ge=1, le=31)]

# Stable error types: the frontend translates them (the loc says which day).
CARD_DAY_REQUIRED = "card_day_required"
CARD_DAY_NOT_ALLOWED = "card_day_not_allowed"
CARD_DAY_NOT_ALLOWED_MESSAGE = "Only credit cards have closing and due days"


class AccountCreate(InputModel):
    type: AccountType
    name: AccountName
    # Validated even when omitted, so a card without days fails on the day's own field.
    closing_day: MonthDay | None = Field(default=None, validate_default=True)
    due_day: MonthDay | None = Field(default=None, validate_default=True)

    @field_validator("closing_day", "due_day")
    @classmethod
    def _days_belong_to_credit_cards(cls, value: int | None, info: ValidationInfo) -> int | None:
        # `type` is declared first, so it is in `info.data` unless it was invalid (then its own
        # error is already reported and there is nothing to compare against).
        account_type = info.data.get("type")
        if account_type is None:
            return value
        if account_type == "credit_card" and value is None:
            raise PydanticCustomError(CARD_DAY_REQUIRED, "A credit card needs this day")
        if account_type != "credit_card" and value is not None:
            raise PydanticCustomError(CARD_DAY_NOT_ALLOWED, CARD_DAY_NOT_ALLOWED_MESSAGE)
        return value


class AccountUpdate(InputModel):
    """Fields to change: only the ones sent are updated. The type of an account cannot change."""

    # Whether the days apply depends on the type of the stored account, so the service checks it.
    name: AccountName | None = None
    closing_day: MonthDay | None = None
    due_day: MonthDay | None = None

    @field_validator("name", "closing_day", "due_day")
    @classmethod
    def _not_null[T](cls, value: T | None) -> T:
        # Runs only for fields that were sent (defaults are not validated). None of the fields can
        # be cleared: a name is required and a card cannot lose a day.
        if value is None:
            raise PydanticCustomError("null_not_allowed", "This field cannot be null")
        return value


class AccountRead(ReadModel):
    id: uuid.UUID
    name: str
    type: AccountType
    closing_day: int | None
    due_day: int | None
    archived_at: datetime | None

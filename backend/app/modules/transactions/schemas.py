import datetime as dt
import re
import uuid
from typing import Annotated, Any, Literal

from pydantic import (
    BeforeValidator,
    Field,
    StringConstraints,
    ValidationInfo,
    field_validator,
)
from pydantic_core import PydanticCustomError

from app.core.schemas import Amount, InputModel, ReadModel, SignedAmount

TransactionType = Literal["expense", "income", "transfer", "adjustment"]
TransactionStatus = Literal["pending", "confirmed", "skipped"]

# Stable error types raised by the service or the schemas: the frontend translates them.
ACCOUNT_NOT_FOUND = "account_not_found"
ACCOUNT_ARCHIVED = "account_archived"
BALANCE_OUT_OF_RANGE = "balance_out_of_range"
CATEGORY_NOT_FOUND = "category_not_found"
CATEGORY_ARCHIVED = "category_archived"
CATEGORY_KIND_MISMATCH = "transaction_category_kind_mismatch"
TRANSFER_SAME_ACCOUNT = "transfer_same_account"

# `[0-9]` and `fullmatch`: `\d` also matches Unicode digits and `$` a trailing newline.
_ISO_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


def _plain_date(value: Any) -> Any:
    """Only an ISO `YYYY-MM-DD` string (or a `date`): no timestamps, no datetimes, no numbers.

    Pydantic's lax `date` also takes `"2026-10-20T00:00:00"`, `datetime` objects and unix
    timestamps. The local date of a movement is a calendar day, so anything else is a client bug.
    """
    if isinstance(value, dt.date) and not isinstance(value, dt.datetime):
        return value
    if isinstance(value, str) and _ISO_DATE.fullmatch(value):
        return value
    raise PydanticCustomError("date_invalid", "Input should be a date in YYYY-MM-DD format")


# The local date of the user in the space's timezone (not a moment). Imported as `dt.date` so
# that a field called `date` does not shadow the type inside the class body.
LocalDate = Annotated[dt.date, BeforeValidator(_plain_date)]

# Trimmed before the length check, so a description of only spaces is as empty as "". The 200 is
# also a CHECK in the database (`ck_transactions_description_length`). Optional: omit it or send
# null.
Description = Annotated[
    str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=200)
]


class _MovementCreate(InputModel):
    """What every type of movement has: the local date and an optional description."""

    date: LocalDate
    description: Description | None = None


class ExpenseCreate(_MovementCreate):
    """Money goes out of an account, classified in an expense category (or its subcategory)."""

    type: Literal["expense"]
    account_id: uuid.UUID
    category_id: uuid.UUID
    amount_minor: Amount


class IncomeCreate(_MovementCreate):
    """Money comes into an account, classified in an income category (or its subcategory)."""

    type: Literal["income"]
    account_id: uuid.UUID
    category_id: uuid.UUID
    amount_minor: Amount


class TransferCreate(_MovementCreate):
    """Money moves between two accounts of the space. Paying a card is a transfer."""

    type: Literal["transfer"]
    from_account_id: uuid.UUID
    to_account_id: uuid.UUID
    amount_minor: Amount

    @field_validator("to_account_id")
    @classmethod
    def _accounts_must_differ(cls, value: uuid.UUID, info: ValidationInfo) -> uuid.UUID:
        # `from_account_id` is declared first, so it is in `info.data` unless it was invalid (then
        # its own error is already reported and there is nothing to compare against).
        if info.data.get("from_account_id") == value:
            raise PydanticCustomError(
                TRANSFER_SAME_ACCOUNT, "A transfer needs two different accounts"
            )
        return value


class AdjustmentCreate(_MovementCreate):
    """A correction of the balance of an account (initial balance, reconciliation).

    `amount_minor` is the change of the balance, with its sign: on a credit card, a negative
    amount raises the debt. It is neither income nor expense, so it has no category.
    """

    type: Literal["adjustment"]
    account_id: uuid.UUID
    amount_minor: SignedAmount


# What the service and `build_entries` accept: the four types.
TransactionCreate = Annotated[
    ExpenseCreate | IncomeCreate | TransferCreate | AdjustmentCreate,
    Field(discriminator="type"),
]

# The body of `POST /spaces/{id}/transactions`: the movements a person registers. No adjustment: the
# backend dates and computes those (initial balance, reconciliation: `create_adjustment`), so a
# client sending `type: "adjustment"` gets a 422 `union_tag_invalid`. A Pydantic error of this union
# has the location `("body", "<type>", "<field>")`; the service builds the same one.
MovementCreate = Annotated[
    ExpenseCreate | IncomeCreate | TransferCreate,
    Field(discriminator="type"),
]


class EntryRead(ReadModel):
    id: uuid.UUID
    account_id: uuid.UUID
    amount_minor: int
    category_id: uuid.UUID | None


class TransactionRead(ReadModel):
    id: uuid.UUID
    type: TransactionType
    status: TransactionStatus
    date: dt.date
    description: str | None
    entries: list[EntryRead]


class BalanceSummaryRead(ReadModel):
    """The balances of the space, in the minor unit of its currency.

    Only confirmed, not deleted movements count. `card_debt_minor` is positive when the cards are
    owed (and negative if a card is paid in excess: it is not clamped, so the net always adds up).
    """

    available_minor: int  # bank and cash accounts
    card_debt_minor: int  # minus the sum of the credit cards' balances
    net_minor: int  # available - debt = the sum of every balance

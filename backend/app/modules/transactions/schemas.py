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

from app.core.schemas import Amount, InputModel, Page, ReadModel, SignedAmount
from app.modules.accounts.schemas import AccountType
from app.modules.categories.schemas import CategoryIcon
from app.modules.transactions.cursor import decode_cursor

TransactionType = Literal["expense", "income", "transfer", "adjustment"]
TransactionStatus = Literal["pending", "confirmed", "skipped"]

# Stable error types raised by the service or the schemas: the frontend translates them.
ACCOUNT_NOT_FOUND = "account_not_found"
ACCOUNT_ARCHIVED = "account_archived"
BALANCE_OUT_OF_RANGE = "balance_out_of_range"
CATEGORY_NOT_FOUND = "category_not_found"
CATEGORY_ARCHIVED = "category_archived"
CATEGORY_KIND_MISMATCH = "transaction_category_kind_mismatch"
CURSOR_INVALID = "cursor_invalid"
IDEMPOTENCY_KEY_REUSED = "idempotency_key_reused"
TRANSACTION_NOT_FOUND = "transaction_not_found"
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


# The movements list ------------------------------------------------------------------------------

# `YYYY-MM`, from 1900 to 2199: a real month, and a year whose following month is a valid `date`.
Month = Annotated[str, StringConstraints(pattern=r"^(19|20|21)[0-9]{2}-(0[1-9]|1[0-2])$")]

# What is searched in the description. Trimmed before the length check, like the description.
SearchText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class TransactionFilters(InputModel):
    """What narrows the movements: the list, its summary and the count all take the same filters.

    Every filter is optional and they combine (AND). `month` is on the local `date` of the
    movement (no timezone involved). `type` omitted means all of them, adjustments included.
    `account_id` keeps the movements that have an entry in that account (both sides of a
    transfer). `category_id` is a main category or a subcategory; a main one includes its
    subcategories. An account or category that does not exist, or is of another space, matches
    nothing. `q` ignores case and accents.
    """

    month: Month | None = None
    type: TransactionType | None = None
    account_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    q: SearchText | None = None


class TransactionListFilters(TransactionFilters):
    """The filters of the list plus its paging. The summary has no `limit` nor `cursor`."""

    limit: Annotated[int, Field(ge=1, le=100)] = 50
    cursor: str | None = None

    @field_validator("cursor")
    @classmethod
    def _cursor_must_be_decodable(cls, value: str | None) -> str | None:
        if value is not None:
            try:
                decode_cursor(value)
            except ValueError:
                raise PydanticCustomError(CURSOR_INVALID, "Invalid cursor") from None
        return value


class AccountRef(ReadModel):
    """An account as a movement shows it (archived ones too)."""

    id: uuid.UUID
    name: str
    type: AccountType


class CategoryParentRef(ReadModel):
    id: uuid.UUID
    name: str
    icon: CategoryIcon


class CategoryRef(ReadModel):
    """A category as a movement shows it; `parent` is the main category of a subcategory."""

    id: uuid.UUID
    name: str
    icon: CategoryIcon
    parent: CategoryParentRef | None


class MovementRead(ReadModel):
    """A movement as the list and the detail show it, in the minor unit of the space's currency.

    `amount_minor` has a sign by type: an expense is negative, an income positive, an adjustment
    carries its own sign (the change of the balance) and a transfer is the unsigned amount that
    moved (to know whether it came in or went out of an account, compare `from_account` and
    `to_account` with it). The accounts depend on the type: an expense, an income and an
    adjustment have `account`; a transfer has `from_account` and `to_account`. Only an expense
    and an income have `category`.
    """

    id: uuid.UUID
    type: TransactionType
    status: TransactionStatus
    date: dt.date
    description: str | None
    amount_minor: int
    category: CategoryRef | None
    account: AccountRef | None
    from_account: AccountRef | None
    to_account: AccountRef | None


class MovementListItem(MovementRead):
    """An item of the list. `balance_after_minor` appears only when the list is filtered by account.

    It is the balance of that account right after this movement, with the sign of `balance_minor`
    (on a credit card, negative = you owe), whatever the other filters are: a movement that the
    filters hide still counts. It is null for a movement that does not count for a balance
    (pending or skipped) and always when there is no `account_id` filter.
    """

    balance_after_minor: int | None


class MovementPage(Page[MovementListItem]):
    pass


class TransactionSummaryRead(ReadModel):
    """What the filtered period adds up to, in the minor unit of the space's currency.

    `income_minor` and `expense_minor` add up only the confirmed incomes and expenses (never
    adjustments, transfers, pending, skipped or deleted ones), both as positive amounts, and
    `remaining_minor` is their difference ("te quedan"). The filters apply as they do to the list,
    `type` included. `count` is every movement the list would show for those filters (any type and
    status, deleted ones excluded): the `m` of "showing n of m".
    """

    count: int
    income_minor: int
    expense_minor: int
    remaining_minor: int

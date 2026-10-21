"""Builds the entries of a new transaction. Pure functions: no session, no database.

The client says "an expense of 1550 in Comida from Itaú"; the backend decides the entries and
their sign. One function per type, chosen with `match` and closed with `assert_never`, so that
adding a type without handling it fails in mypy (and, if it gets past it, at runtime).
"""

import uuid
from dataclasses import dataclass
from typing import assert_never

from app.modules.transactions.schemas import (
    AdjustmentCreate,
    ExpenseCreate,
    IncomeCreate,
    TransactionCreate,
    TransferCreate,
)


@dataclass(frozen=True, slots=True)
class EntryDraft:
    """An entry before it is stored: the signed amount in the minor unit, never zero."""

    account_id: uuid.UUID
    amount_minor: int
    category_id: uuid.UUID | None


def build_entries(data: TransactionCreate) -> list[EntryDraft]:
    match data:
        case ExpenseCreate():
            return expense_entries(data)
        case IncomeCreate():
            return income_entries(data)
        case TransferCreate():
            return transfer_entries(data)
        case AdjustmentCreate():
            return adjustment_entries(data)
        case _:
            assert_never(data)


def expense_entries(data: ExpenseCreate) -> list[EntryDraft]:
    return [EntryDraft(data.account_id, -data.amount_minor, data.category_id)]


def income_entries(data: IncomeCreate) -> list[EntryDraft]:
    return [EntryDraft(data.account_id, data.amount_minor, data.category_id)]


def transfer_entries(data: TransferCreate) -> list[EntryDraft]:
    """Out of the source, into the destination: they add up to zero and carry no category."""
    return [
        EntryDraft(data.from_account_id, -data.amount_minor, None),
        EntryDraft(data.to_account_id, data.amount_minor, None),
    ]


def adjustment_entries(data: AdjustmentCreate) -> list[EntryDraft]:
    """The amount already carries its sign. An adjustment is not income nor expense: no category."""
    return [EntryDraft(data.account_id, data.amount_minor, None)]


def referenced_accounts(data: TransactionCreate) -> list[tuple[str, uuid.UUID]]:
    """`(field name, account id)` of every account the movement touches, in field order."""
    match data:
        case ExpenseCreate() | IncomeCreate() | AdjustmentCreate():
            return [("account_id", data.account_id)]
        case TransferCreate():
            return [
                ("from_account_id", data.from_account_id),
                ("to_account_id", data.to_account_id),
            ]
        case _:
            assert_never(data)

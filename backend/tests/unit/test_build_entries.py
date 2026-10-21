"""`build_entries`: pure functions, one case per transaction type, no database."""

import uuid
from datetime import date
from typing import Any, cast

import pytest

from app.modules.transactions.entries import EntryDraft, build_entries
from app.modules.transactions.schemas import (
    AdjustmentCreate,
    ExpenseCreate,
    IncomeCreate,
    TransactionCreate,
    TransferCreate,
)

MAX_SAFE_INTEGER = 2**53 - 1
DAY = date(2026, 10, 20)
ACCOUNT = uuid.uuid4()
OTHER_ACCOUNT = uuid.uuid4()
CATEGORY = uuid.uuid4()


def _expense(amount: int = 1550) -> ExpenseCreate:
    return ExpenseCreate(
        type="expense", date=DAY, account_id=ACCOUNT, category_id=CATEGORY, amount_minor=amount
    )


def _income(amount: int = 1550) -> IncomeCreate:
    return IncomeCreate(
        type="income", date=DAY, account_id=ACCOUNT, category_id=CATEGORY, amount_minor=amount
    )


def _transfer(amount: int = 3000) -> TransferCreate:
    return TransferCreate(
        type="transfer",
        date=DAY,
        from_account_id=ACCOUNT,
        to_account_id=OTHER_ACCOUNT,
        amount_minor=amount,
    )


def _adjustment(amount: int = 500) -> AdjustmentCreate:
    return AdjustmentCreate(type="adjustment", date=DAY, account_id=ACCOUNT, amount_minor=amount)


def _total(entries: list[EntryDraft]) -> int:
    return sum(e.amount_minor for e in entries)


# expense ------------------------------------------------------------------------------------


def test_an_expense_takes_money_out_of_its_account_and_is_classified() -> None:
    entries = build_entries(_expense(1550))

    assert entries == [EntryDraft(account_id=ACCOUNT, amount_minor=-1550, category_id=CATEGORY)]


# income -------------------------------------------------------------------------------------


def test_an_income_adds_money_to_its_account_and_is_classified() -> None:
    entries = build_entries(_income(1550))

    assert entries == [EntryDraft(account_id=ACCOUNT, amount_minor=1550, category_id=CATEGORY)]


# transfer -----------------------------------------------------------------------------------


@pytest.mark.parametrize("amount", [1, 3000, MAX_SAFE_INTEGER])
def test_a_transfer_adds_up_to_zero(amount: int) -> None:
    assert _total(build_entries(_transfer(amount))) == 0


def test_a_transfer_takes_from_the_source_and_gives_to_the_destination_in_that_order() -> None:
    entries = build_entries(_transfer(3000))

    assert entries == [
        EntryDraft(account_id=ACCOUNT, amount_minor=-3000, category_id=None),
        EntryDraft(account_id=OTHER_ACCOUNT, amount_minor=3000, category_id=None),
    ]


def test_a_transfer_has_no_category() -> None:
    assert [e.category_id for e in build_entries(_transfer())] == [None, None]


# adjustment ---------------------------------------------------------------------------------


@pytest.mark.parametrize("amount", [500, -500, 1, -1, MAX_SAFE_INTEGER, -MAX_SAFE_INTEGER])
def test_an_adjustment_is_one_entry_with_its_own_sign_and_no_category(amount: int) -> None:
    entries = build_entries(_adjustment(amount))

    assert entries == [EntryDraft(account_id=ACCOUNT, amount_minor=amount, category_id=None)]


# all types ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("data", "expected_total"),
    [
        (_expense(1550), -1550),
        (_income(1550), 1550),
        (_transfer(3000), 0),
        (_adjustment(-250), -250),
    ],
    ids=["expense", "income", "transfer", "adjustment"],
)
def test_the_entries_of_each_type_add_up_to_what_that_type_means(
    data: TransactionCreate, expected_total: int
) -> None:
    assert _total(build_entries(data)) == expected_total


@pytest.mark.parametrize(
    "data", [_expense(), _income(), _transfer(), _adjustment(), _adjustment(-7)]
)
def test_no_entry_is_zero(data: TransactionCreate) -> None:
    assert all(e.amount_minor != 0 for e in build_entries(data))


@pytest.mark.parametrize("data", [_transfer(), _adjustment()], ids=["transfer", "adjustment"])
def test_only_expenses_and_incomes_carry_a_category(data: TransactionCreate) -> None:
    assert all(e.category_id is None for e in build_entries(data))


def test_an_entry_draft_cannot_be_changed() -> None:
    entry = build_entries(_expense())[0]

    with pytest.raises(AttributeError):
        entry.amount_minor = 1  # type: ignore[misc]


def test_a_type_that_is_not_handled_fails_loudly() -> None:
    # The `assert_never` of the `match`: mypy catches a missing case, this catches it at runtime.
    unknown = cast(Any, object())

    with pytest.raises(AssertionError):
        build_entries(unknown)

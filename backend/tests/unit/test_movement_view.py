"""`build_movement`: how a stored transaction is shown in the list. Pure, no database."""

import uuid
from datetime import date

import pytest

from app.modules.accounts.schemas import AccountRead
from app.modules.categories.schemas import CategoryRead
from app.modules.transactions.models import Entry, Transaction
from app.modules.transactions.movement_view import build_movement

BANK = uuid.uuid4()
CARD = uuid.uuid4()
MAIN = uuid.uuid4()
SUB = uuid.uuid4()
INCOME = uuid.uuid4()


def _account(account_id: uuid.UUID, name: str, type_: str) -> AccountRead:
    return AccountRead.model_validate(
        {
            "id": account_id,
            "name": name,
            "type": type_,
            "closing_day": None,
            "due_day": None,
            "archived_at": None,
        }
    )


def _category(
    category_id: uuid.UUID,
    name: str,
    icon: str,
    kind: str = "expense",
    parent: uuid.UUID | None = None,
) -> CategoryRead:
    return CategoryRead.model_validate(
        {
            "id": category_id,
            "parent_id": parent,
            "name": name,
            "kind": kind,
            "icon": icon,
            "archived_at": None,
        }
    )


ACCOUNTS = {BANK: _account(BANK, "Itaú", "bank"), CARD: _account(CARD, "Visa", "credit_card")}
CATEGORIES = {
    MAIN: _category(MAIN, "Comida", "fork-knife"),
    SUB: _category(SUB, "Supermercado", "shopping-cart", parent=MAIN),
    INCOME: _category(INCOME, "Sueldo", "money", kind="income"),
}


def _transaction(
    type_: str, entries: list[tuple[uuid.UUID, int, uuid.UUID | None]], **fields: object
) -> Transaction:
    transaction = Transaction(
        id=uuid.uuid7(),
        type=type_,
        status=fields.pop("status", "confirmed"),
        date=date(2026, 10, 20),
        description=fields.pop("description", None),
    )
    transaction.entries = [
        Entry(id=uuid.uuid7(), account_id=a, amount_minor=amount, category_id=c)
        for a, amount, c in entries
    ]
    return transaction


def test_an_expense_is_negative_with_its_category_and_account() -> None:
    movement = build_movement(
        _transaction("expense", [(BANK, -1550, MAIN)], description="Almuerzo"), ACCOUNTS, CATEGORIES
    )
    assert movement.type == "expense"
    assert movement.status == "confirmed"
    assert movement.date == date(2026, 10, 20)
    assert movement.description == "Almuerzo"
    assert movement.amount_minor == -1550
    assert movement.category is not None
    assert (movement.category.id, movement.category.name) == (MAIN, "Comida")
    assert movement.category.icon == "fork-knife"
    assert movement.category.parent is None
    assert movement.account is not None
    assert (movement.account.id, movement.account.name, movement.account.type) == (
        BANK,
        "Itaú",
        "bank",
    )
    assert movement.from_account is None
    assert movement.to_account is None


def test_an_expense_in_a_subcategory_shows_its_principal_category() -> None:
    movement = build_movement(_transaction("expense", [(CARD, -900, SUB)]), ACCOUNTS, CATEGORIES)
    assert movement.category is not None
    assert (movement.category.id, movement.category.name) == (SUB, "Supermercado")
    assert movement.category.parent is not None
    assert movement.category.parent.id == MAIN
    assert movement.category.parent.name == "Comida"
    assert movement.category.parent.icon == "fork-knife"
    assert movement.account is not None
    assert movement.account.type == "credit_card"


def test_an_income_is_positive() -> None:
    movement = build_movement(
        _transaction("income", [(BANK, 90_000, INCOME)]), ACCOUNTS, CATEGORIES
    )
    assert movement.amount_minor == 90_000
    assert movement.category is not None
    assert movement.category.name == "Sueldo"


def test_a_transfer_has_an_unsigned_amount_and_its_two_accounts() -> None:
    movement = build_movement(
        _transaction("transfer", [(BANK, -3000, None), (CARD, 3000, None)]), ACCOUNTS, CATEGORIES
    )
    assert movement.amount_minor == 3000
    assert movement.category is None
    assert movement.account is None
    assert movement.from_account is not None
    assert movement.from_account.id == BANK
    assert movement.to_account is not None
    assert movement.to_account.id == CARD


def test_a_transfer_finds_its_accounts_by_sign_not_by_the_order_of_its_entries() -> None:
    movement = build_movement(
        _transaction("transfer", [(CARD, 3000, None), (BANK, -3000, None)]), ACCOUNTS, CATEGORIES
    )
    assert movement.from_account is not None
    assert movement.from_account.id == BANK
    assert movement.to_account is not None
    assert movement.to_account.id == CARD


@pytest.mark.parametrize("amount", [10_000, -10_000])
def test_an_adjustment_keeps_its_sign_and_has_no_category(amount: int) -> None:
    movement = build_movement(
        _transaction("adjustment", [(BANK, amount, None)]), ACCOUNTS, CATEGORIES
    )
    assert movement.amount_minor == amount
    assert movement.category is None
    assert movement.description is None
    assert movement.account is not None
    assert movement.account.id == BANK
    assert movement.from_account is None
    assert movement.to_account is None


def test_the_status_is_kept() -> None:
    movement = build_movement(
        _transaction("expense", [(BANK, -1, MAIN)], status="pending"), ACCOUNTS, CATEGORIES
    )
    assert movement.status == "pending"


def test_an_unknown_type_is_an_error_not_a_guess() -> None:
    with pytest.raises(ValueError, match="refund"):
        build_movement(_transaction("refund", [(BANK, -1, None)]), ACCOUNTS, CATEGORIES)

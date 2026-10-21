"""Request schemas of `transactions`: pure validation, no database."""

import uuid
from datetime import date
from typing import Any

import pytest
from pydantic import TypeAdapter, ValidationError

from app.modules.transactions.schemas import (
    AdjustmentCreate,
    ExpenseCreate,
    IncomeCreate,
    TransactionCreate,
    TransferCreate,
)

MAX_SAFE_INTEGER = 2**53 - 1
adapter: TypeAdapter[Any] = TypeAdapter(TransactionCreate)
ACCOUNT = str(uuid.uuid4())
OTHER_ACCOUNT = str(uuid.uuid4())
CATEGORY = str(uuid.uuid4())

BODIES: dict[str, dict[str, Any]] = {
    "expense": {
        "type": "expense",
        "date": "2026-10-20",
        "account_id": ACCOUNT,
        "category_id": CATEGORY,
        "amount_minor": 1550,
    },
    "income": {
        "type": "income",
        "date": "2026-10-20",
        "account_id": ACCOUNT,
        "category_id": CATEGORY,
        "amount_minor": 1550,
    },
    "transfer": {
        "type": "transfer",
        "date": "2026-10-20",
        "from_account_id": ACCOUNT,
        "to_account_id": OTHER_ACCOUNT,
        "amount_minor": 3000,
    },
    "adjustment": {
        "type": "adjustment",
        "date": "2026-10-20",
        "account_id": ACCOUNT,
        "amount_minor": -500,
    },
}


def _body(kind: str, **changes: Any) -> dict[str, Any]:
    body = {**BODIES[kind], **changes}
    return {k: v for k, v in body.items() if v is not _MISSING}


_MISSING = object()


def _errors(data: dict[str, Any]) -> list[tuple[str, tuple[Any, ...]]]:
    with pytest.raises(ValidationError) as exc:
        adapter.validate_python(data)
    return [(e["type"], e["loc"]) for e in exc.value.errors()]


# the union ------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("kind", "model"),
    [
        ("expense", ExpenseCreate),
        ("income", IncomeCreate),
        ("transfer", TransferCreate),
        ("adjustment", AdjustmentCreate),
    ],
)
def test_the_type_picks_the_schema(kind: str, model: type) -> None:
    assert isinstance(adapter.validate_python(BODIES[kind]), model)


def test_a_valid_expense_keeps_its_fields() -> None:
    expense = adapter.validate_python(_body("expense", description="  Supermercado "))

    assert isinstance(expense, ExpenseCreate)
    assert expense.date == date(2026, 10, 20)
    assert expense.description == "Supermercado"
    assert str(expense.account_id) == ACCOUNT
    assert str(expense.category_id) == CATEGORY
    assert expense.amount_minor == 1550


@pytest.mark.parametrize("kind", [None, "", "refund", "EXPENSE", 1])
def test_an_unknown_type_is_rejected_as_an_invalid_union_tag(kind: object) -> None:
    # The error is on the union itself (empty loc here, "body" under FastAPI): the tag is wrong.
    assert _errors(_body("expense", type=kind)) == [("union_tag_invalid", ())]


def test_a_missing_type_is_a_union_tag_error() -> None:
    assert _errors(_body("expense", type=_MISSING))[0][0] == "union_tag_not_found"


# fields that do not belong to a type -------------------------------------------------------------


@pytest.mark.parametrize(
    ("kind", "field"),
    [
        ("transfer", "category_id"),
        ("adjustment", "category_id"),
        ("expense", "to_account_id"),
        ("adjustment", "to_account_id"),
        ("expense", "status"),
        ("expense", "created_by"),
        ("income", "space_id"),
    ],
)
def test_a_field_that_is_not_part_of_the_type_is_rejected(kind: str, field: str) -> None:
    errors = _errors(_body(kind, **{field: str(uuid.uuid4())}))

    assert errors == [("extra_forbidden", (kind, field))]


@pytest.mark.parametrize("kind", ["expense", "income"])
def test_expenses_and_incomes_need_a_category(kind: str) -> None:
    assert _errors(_body(kind, category_id=_MISSING)) == [("missing", (kind, "category_id"))]


@pytest.mark.parametrize(
    ("kind", "field"),
    [
        ("expense", "account_id"),
        ("income", "account_id"),
        ("adjustment", "account_id"),
        ("transfer", "from_account_id"),
        ("transfer", "to_account_id"),
    ],
)
def test_the_accounts_are_required(kind: str, field: str) -> None:
    assert _errors(_body(kind, **{field: _MISSING})) == [("missing", (kind, field))]


@pytest.mark.parametrize("kind", ["expense", "income", "transfer", "adjustment"])
def test_the_date_and_the_amount_are_required(kind: str) -> None:
    errors = _errors(_body(kind, date=_MISSING, amount_minor=_MISSING))

    assert sorted(loc[-1] for _, loc in errors) == ["amount_minor", "date"]


# amounts -----------------------------------------------------------------------------------


@pytest.mark.parametrize("kind", ["expense", "income", "transfer"])
@pytest.mark.parametrize("amount", [0, -1, MAX_SAFE_INTEGER + 1, "1550", 15.0, True, None])
def test_amounts_of_expenses_incomes_and_transfers_are_strictly_positive(
    kind: str, amount: object
) -> None:
    errors = _errors(_body(kind, amount_minor=amount))

    assert [loc for _, loc in errors] == [(kind, "amount_minor")]


@pytest.mark.parametrize("kind", ["expense", "income", "transfer"])
def test_the_largest_safe_amount_is_accepted(kind: str) -> None:
    assert adapter.validate_python(_body(kind, amount_minor=MAX_SAFE_INTEGER)).amount_minor == (
        MAX_SAFE_INTEGER
    )


@pytest.mark.parametrize("amount", [500, -500, 1, -1, MAX_SAFE_INTEGER, -MAX_SAFE_INTEGER])
def test_an_adjustment_may_be_positive_or_negative(amount: int) -> None:
    adjustment = adapter.validate_python(_body("adjustment", amount_minor=amount))

    assert isinstance(adjustment, AdjustmentCreate)
    assert adjustment.amount_minor == amount


def test_an_adjustment_of_zero_is_rejected() -> None:
    assert _errors(_body("adjustment", amount_minor=0)) == [
        ("amount_zero", ("adjustment", "amount_minor"))
    ]


@pytest.mark.parametrize("amount", [MAX_SAFE_INTEGER + 1, -MAX_SAFE_INTEGER - 1, "5", 1.0, False])
def test_an_adjustment_beyond_the_limit_or_not_an_integer_is_rejected(amount: object) -> None:
    errors = _errors(_body("adjustment", amount_minor=amount))

    assert [loc for _, loc in errors] == [("adjustment", "amount_minor")]


# transfer -----------------------------------------------------------------------------------


def test_a_transfer_between_the_same_account_is_rejected_on_the_destination() -> None:
    errors = _errors(_body("transfer", to_account_id=ACCOUNT))

    assert errors == [("transfer_same_account", ("transfer", "to_account_id"))]


def test_a_transfer_between_two_accounts_is_valid() -> None:
    transfer = adapter.validate_python(BODIES["transfer"])

    assert isinstance(transfer, TransferCreate)
    assert transfer.from_account_id != transfer.to_account_id


# description --------------------------------------------------------------------------------


@pytest.mark.parametrize("kind", ["expense", "income", "transfer", "adjustment"])
def test_the_description_is_optional(kind: str) -> None:
    assert adapter.validate_python(_body(kind)).description is None
    assert adapter.validate_python(_body(kind, description=None)).description is None


def test_a_description_of_exactly_200_characters_is_valid() -> None:
    assert len(adapter.validate_python(_body("expense", description="a" * 200)).description) == 200


@pytest.mark.parametrize("description", ["", "   ", "\t\n", "a" * 201, 5])
def test_a_blank_too_long_or_non_string_description_is_rejected(description: object) -> None:
    errors = _errors(_body("expense", description=description))

    assert [loc for _, loc in errors] == [("expense", "description")]


# date ---------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value", [1760918400, "2026-10-20T00:00:00", "20/10/2026", "2026-13-01", "", None]
)
def test_the_date_must_be_a_plain_iso_date(value: object) -> None:
    errors = _errors(_body("expense", date=value))

    assert [loc for _, loc in errors] == [("expense", "date")]


# ids ----------------------------------------------------------------------------------------


@pytest.mark.parametrize("field", ["account_id", "category_id"])
def test_ids_must_be_uuids(field: str) -> None:
    errors = _errors(_body("expense", **{field: "not-a-uuid"}))

    assert [loc for _, loc in errors] == [("expense", field)]

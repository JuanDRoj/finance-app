"""Request schemas of `accounts`: pure validation, no database."""

from typing import Any

import pytest
from pydantic import ValidationError

from app.modules.accounts.schemas import AccountCreate, AccountUpdate


def _errors(model: type[AccountCreate] | type[AccountUpdate], data: dict[str, Any]) -> list[Any]:
    with pytest.raises(ValidationError) as exc:
        model.model_validate(data)
    return [(e["type"], e["loc"]) for e in exc.value.errors()]


# AccountCreate ------------------------------------------------------------------------------


@pytest.mark.parametrize("kind", ["bank", "cash"])
def test_bank_and_cash_need_no_days(kind: str) -> None:
    account = AccountCreate.model_validate({"type": kind, "name": "Itaú"})

    assert (account.type, account.name) == (kind, "Itaú")
    assert (account.closing_day, account.due_day) == (None, None)


def test_a_credit_card_with_both_days_is_valid() -> None:
    account = AccountCreate.model_validate(
        {"type": "credit_card", "name": "Visa", "closing_day": 5, "due_day": 12}
    )

    assert (account.closing_day, account.due_day) == (5, 12)


def test_the_name_is_stripped() -> None:
    assert AccountCreate.model_validate({"type": "cash", "name": "  Billetera \n"}).name == (
        "Billetera"
    )


def test_a_name_of_exactly_80_characters_is_valid() -> None:
    assert len(AccountCreate.model_validate({"type": "cash", "name": "a" * 80}).name) == 80


@pytest.mark.parametrize("name", ["", "   ", "\t\n", "a" * 81, None, 5])
def test_an_empty_blank_too_long_or_non_string_name_is_rejected(name: object) -> None:
    errors = _errors(AccountCreate, {"type": "cash", "name": name})

    assert [loc for _, loc in errors] == [("name",)]


def test_the_name_is_required() -> None:
    assert _errors(AccountCreate, {"type": "cash"}) == [("missing", ("name",))]


@pytest.mark.parametrize("kind", ["savings", "CASH", "", None, 1])
def test_an_unknown_type_is_rejected(kind: object) -> None:
    errors = _errors(AccountCreate, {"type": kind, "name": "x"})

    assert [loc for _, loc in errors] == [("type",)]


def test_the_type_is_required() -> None:
    assert _errors(AccountCreate, {"name": "x"}) == [("missing", ("type",))]


def test_a_credit_card_without_days_reports_each_missing_day() -> None:
    assert _errors(AccountCreate, {"type": "credit_card", "name": "Visa"}) == [
        ("card_day_required", ("closing_day",)),
        ("card_day_required", ("due_day",)),
    ]


def test_a_credit_card_with_only_one_day_reports_the_other() -> None:
    assert _errors(AccountCreate, {"type": "credit_card", "name": "V", "closing_day": 5}) == [
        ("card_day_required", ("due_day",))
    ]
    assert _errors(AccountCreate, {"type": "credit_card", "name": "V", "due_day": 5}) == [
        ("card_day_required", ("closing_day",))
    ]


def test_an_explicit_null_day_on_a_credit_card_is_missing_too() -> None:
    errors = _errors(
        AccountCreate, {"type": "credit_card", "name": "V", "closing_day": None, "due_day": 3}
    )

    assert errors == [("card_day_required", ("closing_day",))]


@pytest.mark.parametrize("kind", ["bank", "cash"])
@pytest.mark.parametrize("field", ["closing_day", "due_day"])
def test_days_are_not_allowed_outside_credit_cards(kind: str, field: str) -> None:
    errors = _errors(AccountCreate, {"type": kind, "name": "x", field: 5})

    assert errors == [("card_day_not_allowed", (field,))]


@pytest.mark.parametrize("day", [0, 32, -1, 100])
@pytest.mark.parametrize("field", ["closing_day", "due_day"])
def test_days_outside_1_to_31_are_rejected(day: int, field: str) -> None:
    other = "due_day" if field == "closing_day" else "closing_day"
    data = {"type": "credit_card", "name": "V", field: day, other: 10}

    assert [loc for _, loc in _errors(AccountCreate, data)] == [(field,)]


@pytest.mark.parametrize("day", [1, 31])
def test_the_limits_1_and_31_are_valid_days(day: int) -> None:
    account = AccountCreate.model_validate(
        {"type": "credit_card", "name": "V", "closing_day": day, "due_day": day}
    )

    assert (account.closing_day, account.due_day) == (day, day)


@pytest.mark.parametrize("day", ["5", 5.0, True])
def test_days_must_be_real_integers(day: object) -> None:
    data = {"type": "credit_card", "name": "V", "closing_day": day, "due_day": 10}

    assert [loc for _, loc in _errors(AccountCreate, data)] == [("closing_day",)]


@pytest.mark.parametrize("field", ["archived_at", "space_id", "id", "initial_balance_minor"])
def test_create_rejects_fields_that_are_not_part_of_the_contract(field: str) -> None:
    errors = _errors(AccountCreate, {"type": "cash", "name": "x", field: "anything"})

    assert errors == [("extra_forbidden", (field,))]


# AccountUpdate ------------------------------------------------------------------------------


def test_an_empty_update_is_valid_and_sets_nothing() -> None:
    update = AccountUpdate.model_validate({})

    assert update.model_dump(exclude_unset=True) == {}


def test_an_update_keeps_only_the_fields_that_were_sent() -> None:
    update = AccountUpdate.model_validate({"name": " Nuevo ", "closing_day": 3})

    assert update.model_dump(exclude_unset=True) == {"name": "Nuevo", "closing_day": 3}


@pytest.mark.parametrize("field", ["type", "archived_at", "space_id", "id"])
def test_update_does_not_accept_the_type_or_other_fields(field: str) -> None:
    errors = _errors(AccountUpdate, {field: "cash"})

    assert errors == [("extra_forbidden", (field,))]


@pytest.mark.parametrize("field", ["name", "closing_day", "due_day"])
def test_update_rejects_an_explicit_null(field: str) -> None:
    assert _errors(AccountUpdate, {field: None}) == [("null_not_allowed", (field,))]


@pytest.mark.parametrize("name", ["", "   ", "a" * 81])
def test_update_rejects_a_blank_or_too_long_name(name: str) -> None:
    assert [loc for _, loc in _errors(AccountUpdate, {"name": name})] == [("name",)]


@pytest.mark.parametrize("day", [0, 32, "5", 5.0, True])
@pytest.mark.parametrize("field", ["closing_day", "due_day"])
def test_update_rejects_invalid_days(day: object, field: str) -> None:
    assert [loc for _, loc in _errors(AccountUpdate, {field: day})] == [(field,)]

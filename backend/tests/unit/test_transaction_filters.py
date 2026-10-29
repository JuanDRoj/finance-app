"""Query filters of the movements list: pure validation, no database."""

import uuid
from datetime import date
from typing import Any

import pytest
from pydantic import ValidationError

from app.modules.transactions.cursor import encode_cursor
from app.modules.transactions.schemas import TransactionFilters, TransactionListFilters

ACCOUNT = uuid.uuid4()


def _error(model: type[TransactionFilters], data: dict[str, Any]) -> tuple[str, tuple[Any, ...]]:
    with pytest.raises(ValidationError) as exc:
        model.model_validate(data)
    [issue] = exc.value.errors()
    return issue["type"], issue["loc"]


def test_every_filter_is_optional_and_the_list_defaults_to_fifty() -> None:
    filters = TransactionListFilters.model_validate({})
    assert (filters.month, filters.type, filters.account_id) == (None, None, None)
    assert (filters.category_id, filters.q, filters.cursor) == (None, None, None)
    assert filters.limit == 50


def test_filters_accept_valid_values_as_strings_like_a_query_string() -> None:
    filters = TransactionListFilters.model_validate(
        {
            "month": "2026-10",
            "type": "transfer",
            "account_id": str(ACCOUNT),
            "category_id": str(ACCOUNT),
            "q": "  café  ",
            "limit": "100",
        }
    )
    assert filters.month == "2026-10"
    assert filters.type == "transfer"
    assert filters.account_id == ACCOUNT
    assert filters.q == "café"
    assert filters.limit == 100


@pytest.mark.parametrize("limit", ["0", "101", "-1", "abc"])
def test_limit_outside_one_to_a_hundred_is_rejected(limit: str) -> None:
    _, loc = _error(TransactionListFilters, {"limit": limit})
    assert loc == ("limit",)


@pytest.mark.parametrize("month", ["2026-13", "2026-00", "2026-1", "26-10", "2026/10", "abcd-ef"])
def test_a_month_must_be_year_dash_month(month: str) -> None:
    type_, loc = _error(TransactionFilters, {"month": month})
    assert (type_, loc) == ("string_pattern_mismatch", ("month",))


@pytest.mark.parametrize("month", ["0000-01", "1899-12", "2200-01", "9999-12"])
def test_a_month_outside_the_supported_years_is_rejected(month: str) -> None:
    _, loc = _error(TransactionFilters, {"month": month})
    assert loc == ("month",)


@pytest.mark.parametrize("type_", ["all", "Expense", "", "refund"])
def test_an_unknown_type_is_rejected(type_: str) -> None:
    kind, loc = _error(TransactionFilters, {"type": type_})
    assert (kind, loc) == ("literal_error", ("type",))


@pytest.mark.parametrize("type_", ["expense", "income", "transfer", "adjustment"])
def test_the_four_types_are_accepted(type_: str) -> None:
    assert TransactionFilters.model_validate({"type": type_}).type == type_


@pytest.mark.parametrize("field", ["account_id", "category_id"])
def test_ids_must_be_uuids(field: str) -> None:
    _, loc = _error(TransactionFilters, {field: "not-a-uuid"})
    assert loc == (field,)


@pytest.mark.parametrize("q", ["", "   "])
def test_a_blank_search_is_rejected(q: str) -> None:
    _, loc = _error(TransactionFilters, {"q": q})
    assert loc == ("q",)


def test_a_search_longer_than_a_hundred_characters_is_rejected() -> None:
    _, loc = _error(TransactionFilters, {"q": "x" * 101})
    assert loc == ("q",)
    assert TransactionFilters.model_validate({"q": "x" * 100}).q == "x" * 100


def test_an_unknown_parameter_is_rejected() -> None:
    assert _error(TransactionListFilters, {"sort": "amount"}) == ("extra_forbidden", ("sort",))


@pytest.mark.parametrize("field", ["limit", "cursor"])
def test_the_summary_filters_do_not_accept_paging(field: str) -> None:
    value = encode_cursor(date(2026, 10, 20), uuid.uuid4()) if field == "cursor" else "10"
    assert _error(TransactionFilters, {field: value}) == ("extra_forbidden", (field,))


def test_a_valid_cursor_is_kept_as_it_came() -> None:
    cursor = encode_cursor(date(2026, 10, 20), uuid.uuid4())
    assert TransactionListFilters.model_validate({"cursor": cursor}).cursor == cursor


@pytest.mark.parametrize("cursor", ["", "garbage", "!!!", "MjAyNi0xMC0yMA"])
def test_a_cursor_that_cannot_be_decoded_is_a_cursor_invalid_error(cursor: str) -> None:
    assert _error(TransactionListFilters, {"cursor": cursor}) == ("cursor_invalid", ("cursor",))

"""Request schema of `spaces`: pure validation, no database."""

from typing import Any

import pytest
from pydantic import ValidationError

from app.modules.spaces.schemas import SpaceUpdate


def _errors(data: dict[str, Any]) -> list[Any]:
    with pytest.raises(ValidationError) as exc:
        SpaceUpdate.model_validate(data)
    return [(e["type"], e["loc"]) for e in exc.value.errors()]


def test_an_empty_update_is_valid_and_sets_nothing() -> None:
    update = SpaceUpdate.model_validate({})

    assert update.model_dump(exclude_unset=True) == {}


@pytest.mark.parametrize("code", ["UYU", "USD", "CLP", "XXX"])
def test_the_currency_is_checked_for_format_only(code: str) -> None:
    # Whether it is supported is up to `currencies` (the service), not to the schema.
    update = SpaceUpdate.model_validate({"currency": code})

    assert update.model_dump(exclude_unset=True) == {"currency": code}


@pytest.mark.parametrize("code", ["usd", "US", "USDD", "", " USD", "US1", "USD\n"])
def test_a_malformed_currency_code_is_rejected(code: str) -> None:
    assert [loc for _, loc in _errors({"currency": code})] == [("currency",)]


@pytest.mark.parametrize("value", [123, 1.5, True, ["USD"]])
def test_a_currency_that_is_not_a_string_is_rejected(value: Any) -> None:
    assert [loc for _, loc in _errors({"currency": value})] == [("currency",)]


def test_a_null_currency_is_rejected_with_null_not_allowed() -> None:
    assert _errors({"currency": None}) == [("null_not_allowed", ("currency",))]


@pytest.mark.parametrize("field", ["name", "timezone", "type", "id", "currency_locked"])
def test_no_other_field_is_editable(field: str) -> None:
    assert _errors({field: "x"}) == [("extra_forbidden", (field,))]

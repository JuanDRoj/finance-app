from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.core.schemas import Amount, InputModel, ReadModel
from app.modules.currencies.schemas import CurrencyRead

MAX_SAFE = 2**53 - 1


class _Payment(InputModel):
    amount_minor: Amount


class _Thing(ReadModel):
    name: str


def test_input_model_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError) as exc:
        _Payment.model_validate({"amount_minor": 1, "surprise": True})
    assert exc.value.errors()[0]["type"] == "extra_forbidden"


@pytest.mark.parametrize("value", [1550, MAX_SAFE])
def test_amount_in_an_input_model_accepts_valid_values(value: int) -> None:
    assert _Payment.model_validate({"amount_minor": value}).amount_minor == value


@pytest.mark.parametrize("value", ["1550", 15.0, True, 0, -1, MAX_SAFE + 1, None])
def test_amount_in_an_input_model_rejects_invalid_values(value: object) -> None:
    with pytest.raises(ValidationError):
        _Payment.model_validate({"amount_minor": value})


def test_read_model_validates_from_object_attributes() -> None:
    assert _Thing.model_validate(SimpleNamespace(name="x")).name == "x"


def test_currency_read_is_a_read_model() -> None:
    assert issubclass(CurrencyRead, ReadModel)

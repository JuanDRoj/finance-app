import pytest
from pydantic import TypeAdapter, ValidationError

from app.modules.currencies.schemas import CurrencyCode

adapter = TypeAdapter(CurrencyCode)


def test_currency_code_accepts_three_uppercase_letters() -> None:
    assert adapter.validate_python("UYU") == "UYU"


@pytest.mark.parametrize("value", ["usd", "US", "USDD", "US1", "U\x00D", "UYU\n", 123, None])
def test_currency_code_rejects_malformed_values_and_non_strings(value: object) -> None:
    with pytest.raises(ValidationError):
        adapter.validate_python(value)

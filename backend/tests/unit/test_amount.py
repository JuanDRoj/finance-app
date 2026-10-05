import pytest
from pydantic import TypeAdapter, ValidationError

from app.core.schemas import Amount

MAX_SAFE_INTEGER = 2**53 - 1
adapter = TypeAdapter(Amount)


@pytest.mark.parametrize("value", [1, 1550, MAX_SAFE_INTEGER])
def test_amount_accepts_positive_integers_up_to_the_js_safe_limit(value: int) -> None:
    assert adapter.validate_python(value) == value


@pytest.mark.parametrize("value", [0, -1, MAX_SAFE_INTEGER + 1, "1550", 15.0, True])
def test_amount_rejects_non_positive_too_large_and_non_integer_values(value: object) -> None:
    with pytest.raises(ValidationError):
        adapter.validate_python(value)

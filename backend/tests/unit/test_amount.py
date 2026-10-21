import pytest
from pydantic import TypeAdapter, ValidationError

from app.core.schemas import Amount, SignedAmount

MAX_SAFE_INTEGER = 2**53 - 1
adapter = TypeAdapter(Amount)


@pytest.mark.parametrize("value", [1, 1550, MAX_SAFE_INTEGER])
def test_amount_accepts_positive_integers_up_to_the_js_safe_limit(value: int) -> None:
    assert adapter.validate_python(value) == value


@pytest.mark.parametrize("value", [0, -1, MAX_SAFE_INTEGER + 1, "1550", 15.0, True])
def test_amount_rejects_non_positive_too_large_and_non_integer_values(value: object) -> None:
    with pytest.raises(ValidationError):
        adapter.validate_python(value)


# SignedAmount: the amount of an adjustment (a balance delta), the only signed money in the API.

signed_adapter = TypeAdapter(SignedAmount)


@pytest.mark.parametrize("value", [1, -1, 1550, -1550, MAX_SAFE_INTEGER, -MAX_SAFE_INTEGER])
def test_signed_amount_accepts_non_zero_integers_up_to_the_js_safe_limit(value: int) -> None:
    assert signed_adapter.validate_python(value) == value


@pytest.mark.parametrize(
    "value", [MAX_SAFE_INTEGER + 1, -MAX_SAFE_INTEGER - 1, "1550", "-5", 15.0, -2.0, True]
)
def test_signed_amount_rejects_too_large_and_non_integer_values(value: object) -> None:
    with pytest.raises(ValidationError):
        signed_adapter.validate_python(value)


def test_signed_amount_rejects_zero_with_a_stable_error_type() -> None:
    with pytest.raises(ValidationError) as exc:
        signed_adapter.validate_python(0)

    assert [e["type"] for e in exc.value.errors()] == ["amount_zero"]

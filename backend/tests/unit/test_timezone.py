import pytest
from pydantic import TypeAdapter, ValidationError

from app.core.schemas import Timezone

adapter = TypeAdapter(Timezone)


@pytest.mark.parametrize("value", ["America/Montevideo", "UTC", "Etc/GMT+5", "US/Pacific"])
def test_iana_timezones_are_accepted(value: str) -> None:
    assert adapter.validate_python(value) == value


@pytest.mark.parametrize(
    "value",
    [
        "",
        " ",
        "Mars/Olympus",
        "america/montevideo",
        "../etc/passwd",
        "/usr/share/zoneinfo/UTC",
        "localtime",
        "posixrules",
        "UTC\n",
    ],
)
def test_anything_else_is_rejected_with_a_stable_error_type(value: str) -> None:
    with pytest.raises(ValidationError) as exc:
        adapter.validate_python(value)

    assert exc.value.errors()[0]["type"] == "timezone_invalid"


@pytest.mark.parametrize("value", [None, 3, b"UTC"])
def test_non_strings_are_rejected(value: object) -> None:
    with pytest.raises(ValidationError):
        adapter.validate_python(value)

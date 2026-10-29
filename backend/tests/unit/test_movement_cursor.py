"""The cursor of the movements list and the month filter: pure functions, no database."""

import base64
import uuid
from datetime import date

import pytest

from app.modules.transactions.cursor import decode_cursor, encode_cursor, month_bounds

ID = uuid.UUID("0197c6a0-1b2c-7d3e-8f40-5162738495a6")


def _b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode()).decode().rstrip("=")


def test_cursor_round_trips() -> None:
    assert decode_cursor(encode_cursor(date(2026, 10, 20), ID)) == (date(2026, 10, 20), ID)


def test_cursor_is_url_safe_and_unpadded() -> None:
    cursor = encode_cursor(date(2026, 10, 20), ID)
    assert cursor.isascii()
    assert not set(cursor) & set("+/=")


def test_cursor_does_not_show_its_content_as_plain_text() -> None:
    cursor = encode_cursor(date(2026, 10, 20), ID)
    assert "2026" not in cursor
    assert str(ID) not in cursor


def test_different_positions_give_different_cursors() -> None:
    assert encode_cursor(date(2026, 10, 20), ID) != encode_cursor(date(2026, 10, 19), ID)
    assert encode_cursor(date(2026, 10, 20), ID) != encode_cursor(date(2026, 10, 20), uuid.uuid7())


@pytest.mark.parametrize(
    "cursor",
    [
        "",
        "not a cursor",
        "!!!!",
        "a",  # a single base64 character cannot be decoded
        _b64("garbage"),
        _b64("2026-10-20"),  # the id is missing
        _b64(f"2026-10-20|{ID}|extra"),
        _b64(f"2026-13-40|{ID}"),  # not a date
        _b64(f"20261020|{ID}"),  # not ISO
        _b64(f"2026-10-20T00:00:00|{ID}"),  # a timestamp is not a day
        _b64("2026-10-20|not-a-uuid"),
        _b64(f"|{ID}"),
        "éè",  # not ASCII
    ],
)
def test_a_cursor_that_cannot_be_decoded_raises_value_error(cursor: str) -> None:
    with pytest.raises(ValueError, match="cursor"):
        decode_cursor(cursor)


@pytest.mark.parametrize(
    ("month", "first", "next_first"),
    [
        ("2026-10", date(2026, 10, 1), date(2026, 11, 1)),
        ("2026-01", date(2026, 1, 1), date(2026, 2, 1)),
        ("2026-02", date(2026, 2, 1), date(2026, 3, 1)),
        ("2026-12", date(2026, 12, 1), date(2027, 1, 1)),
        ("1900-01", date(1900, 1, 1), date(1900, 2, 1)),
        ("2199-12", date(2199, 12, 1), date(2200, 1, 1)),
    ],
)
def test_month_bounds_are_the_first_day_and_the_first_day_of_the_next_month(
    month: str, first: date, next_first: date
) -> None:
    assert month_bounds(month) == (first, next_first)

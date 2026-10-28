"""The cursor of the movements list and the month filter. Pure functions: no session, no database.

The list is ordered by `date desc, id desc`, so the position after a page is the `(date, id)` of
its last item. The cursor is that pair, opaque to the client (base64 url-safe, no padding): the
client only sends it back. It carries no authority, only a position, and every query still
filters by the space, so a cursor made in another space cannot show anything of it.
"""

import base64
import binascii
import uuid
from datetime import date

_SEPARATOR = "|"


def encode_cursor(day: date, transaction_id: uuid.UUID) -> str:
    raw = f"{day.isoformat()}{_SEPARATOR}{transaction_id}".encode("ascii")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_cursor(cursor: str) -> tuple[date, uuid.UUID]:
    """The `(date, id)` of a cursor; `ValueError` if `encode_cursor` did not make it."""
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii") + b"=" * (-len(cursor) % 4))
        day_text, id_text = raw.decode("ascii").split(_SEPARATOR)
        # `date.fromisoformat` also reads "20261020"; the cursor only ever holds `YYYY-MM-DD`.
        day = date.fromisoformat(day_text)
        if day.isoformat() != day_text:
            raise ValueError(day_text)
        transaction_id = uuid.UUID(id_text)
        if str(transaction_id) != id_text:
            raise ValueError(id_text)
    except (ValueError, binascii.Error, UnicodeError) as error:
        raise ValueError("Invalid cursor") from error
    return day, transaction_id


def month_bounds(month: str) -> tuple[date, date]:
    """`"2026-10"` -> the first day of the month and the first day of the next one.

    The filter is `first <= date < next_first`. `transactions.date` is already the local day of
    the space, so no timezone conversion is needed: which month is "the current one" is the
    client's question (it knows the timezone of the space). The caller validates the format
    (`Month` in `schemas`).
    """
    year, number = (int(part) for part in month.split("-"))
    first = date(year, number, 1)
    following = date(year + 1, 1, 1) if number == 12 else date(year, number + 1, 1)
    return first, following

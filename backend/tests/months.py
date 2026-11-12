"""The current month of the space and its neighbours, for the tests of the API that date data.

The API takes the clock itself (`datetime.now(UTC)`), so a test that needs data in "this month" or
"last month" dates it relative to today in the timezone of `make_user_and_space` (Montevideo). The
`months` fixture of `tests/api/conftest.py` builds it with `current_months`, which reads the clock
when each test starts and not when the module is imported. Tests with an injected clock (services)
do not need it.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class Months:
    """The current month of the space and its neighbours, read from the clock once per test."""

    first: date  # the first day of the current month: always inside it
    month: str  # `YYYY-MM` of the current month, as the dashboard and the filters name it
    last_month: date  # the last day of the previous month
    last_month_name: str  # `YYYY-MM` of the previous month
    two_months_ago: date  # a day of the month before the previous one
    two_months_ago_name: str  # `YYYY-MM` of that month
    next_month: date  # the first day of the next month


def current_months() -> Months:
    today = datetime.now(UTC).astimezone(ZoneInfo("America/Montevideo")).date()
    first = today.replace(day=1)
    last_month = first - timedelta(days=1)
    two_months_ago = first - timedelta(days=40)
    return Months(
        first=first,
        month=first.strftime("%Y-%m"),
        last_month=last_month,
        last_month_name=last_month.strftime("%Y-%m"),
        two_months_ago=two_months_ago,
        two_months_ago_name=two_months_ago.strftime("%Y-%m"),
        next_month=(first + timedelta(days=32)).replace(day=1),
    )

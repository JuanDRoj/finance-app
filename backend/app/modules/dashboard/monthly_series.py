"""The monthly series of the dashboard. Pure functions: no session, no database.

`transactions` gives the totals of every month that has movements, keyed by `"YYYY-MM"`, and the
router knows which month is the current one in the timezone of the space. This module only does the
arithmetic of the series: the window of months, the zero fill and the running net.

Months are compared as text. They are always `YYYY-MM` with a four digit year (`to_char` pads it
and a `date` has no more than four), so the alphabetical order is the chronological one.
"""

from collections.abc import Mapping, Sequence

from app.modules.dashboard.schemas import MonthlySeriesPoint
from app.modules.transactions.schemas import MonthlyTotals

_NOTHING = MonthlyTotals(income_minor=0, expense_minor=0, net_change_minor=0)


def month_window(current: str, count: int) -> list[str]:
    """The `count` months that end in `current` (`"2026-11"`), oldest first, across years.

    `month_window("2027-02", 6)` is September 2026 to February 2027. `count` must be at least 1.
    """
    if count < 1:
        raise ValueError("A window needs at least one month")
    year, number = (int(part) for part in current.split("-"))
    index = year * 12 + (number - 1)  # months since the year 0
    return [f"{i // 12:04d}-{i % 12 + 1:02d}" for i in range(index - count + 1, index + 1)]


def build_points(
    totals: Mapping[str, MonthlyTotals], window: Sequence[str]
) -> list[MonthlySeriesPoint]:
    """One point per month of `window` (oldest first, the last is the current month).

    `totals` holds the months of the whole history that have movements. A month of the window
    without them has 0 income and expense. The net starts from everything before the window (the
    opening) and each month adds its net change, so a month without movements keeps the net of the
    one before and the months before the first movement are 0. The last point is the net of today:
    it also takes in what is dated after the window (a movement of next month already confirmed is
    in the balance), which belongs to no flow of the window.
    """
    first, last = window[0], window[-1]
    net = sum(t.net_change_minor for month, t in totals.items() if month < first)
    after = sum(t.net_change_minor for month, t in totals.items() if month > last)
    points: list[MonthlySeriesPoint] = []
    for month in window:
        month_totals = totals.get(month, _NOTHING)
        net += month_totals.net_change_minor
        points.append(
            MonthlySeriesPoint(
                month=month,
                income_minor=month_totals.income_minor,
                expense_minor=month_totals.expense_minor,
                net_minor=net + after if month == last else net,
            )
        )
    return points

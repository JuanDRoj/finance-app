"""The monthly series of the dashboard: the window of months and the running net, pure functions."""

import re

import pytest

from app.modules.dashboard.monthly_series import build_points, month_window
from app.modules.dashboard.schemas import MAX_SERIES_MONTHS, MonthlySeriesPoint
from app.modules.transactions.schemas import MonthlyTotals

MONTH = re.compile(r"^(19|20|21)[0-9]{2}-(0[1-9]|1[0-2])$")


def _totals(income: int = 0, expense: int = 0, net_change: int | None = None) -> MonthlyTotals:
    """A month; the net change is `income - expense` unless adjustments or the like move it."""
    return MonthlyTotals(
        income_minor=income,
        expense_minor=expense,
        net_change_minor=income - expense if net_change is None else net_change,
    )


def _row(point: MonthlySeriesPoint) -> tuple[str, int, int, int]:
    return (point.month, point.income_minor, point.expense_minor, point.net_minor)


# month_window ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("current", "count", "expected"),
    [
        ("2026-11", 6, ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]),
        ("2027-02", 6, ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]),
        ("2026-11", 1, ["2026-11"]),
        ("2026-01", 2, ["2025-12", "2026-01"]),
        ("2026-12", 1, ["2026-12"]),
        (
            "2026-03",
            12,
            [
                "2025-04",
                "2025-05",
                "2025-06",
                "2025-07",
                "2025-08",
                "2025-09",
                "2025-10",
                "2025-11",
                "2025-12",
                "2026-01",
                "2026-02",
                "2026-03",
            ],
        ),
    ],
)
def test_the_window_ends_in_the_current_month_and_goes_back_across_years(
    current: str, count: int, expected: list[str]
) -> None:
    assert month_window(current, count) == expected


def test_every_window_has_the_asked_length_ascending_and_in_the_month_format() -> None:
    for year in (2025, 2026, 2027):
        for number in range(1, 13):
            current = f"{year}-{number:02d}"
            for count in range(1, MAX_SERIES_MONTHS + 1):
                window = month_window(current, count)
                assert len(window) == count
                assert window[-1] == current
                assert window == sorted(set(window))
                assert all(MONTH.fullmatch(month) for month in window)


@pytest.mark.parametrize("count", [0, -1])
def test_a_window_needs_at_least_one_month(count: int) -> None:
    with pytest.raises(ValueError, match="at least one"):
        month_window("2026-11", count)


# build_points ----------------------------------------------------------------------------------


def test_without_totals_every_month_is_zero() -> None:
    points = build_points({}, ["2026-09", "2026-10", "2026-11"])

    assert [_row(p) for p in points] == [
        ("2026-09", 0, 0, 0),
        ("2026-10", 0, 0, 0),
        ("2026-11", 0, 0, 0),
    ]


def test_a_month_without_movements_has_no_flows_and_keeps_the_net_of_the_month_before() -> None:
    totals = {"2026-09": _totals(income=1_000, expense=300), "2026-11": _totals(expense=200)}

    points = build_points(totals, ["2026-09", "2026-10", "2026-11"])

    assert [_row(p) for p in points] == [
        ("2026-09", 1_000, 300, 700),
        ("2026-10", 0, 0, 700),
        ("2026-11", 0, 200, 500),
    ]


def test_months_before_the_first_movement_have_a_net_of_zero() -> None:
    points = build_points({"2026-10": _totals(income=50)}, ["2026-08", "2026-09", "2026-10"])

    assert [p.net_minor for p in points] == [0, 0, 50]


def test_the_expense_is_a_positive_amount_and_the_net_can_be_negative() -> None:
    points = build_points({"2026-11": _totals(income=100, expense=900)}, ["2026-11"])

    assert _row(points[0]) == ("2026-11", 100, 900, -800)


def test_an_adjustment_moves_the_net_and_neither_the_income_nor_the_expense() -> None:
    # `net_change_minor` is the whole signed sum of the month; it is not `income - expense`.
    totals = {"2026-10": _totals(income=10, expense=4, net_change=5_006)}

    points = build_points(totals, ["2026-10", "2026-11"])

    assert [_row(p) for p in points] == [
        ("2026-10", 10, 4, 5_006),
        ("2026-11", 0, 0, 5_006),
    ]


def test_everything_before_the_window_is_in_the_opening_net_but_not_in_the_flows() -> None:
    totals = {
        "2024-01": _totals(income=7_000),
        "2026-05": _totals(expense=500),
        "2026-06": _totals(expense=100),
    }

    points = build_points(totals, ["2026-06", "2026-07"])

    assert [_row(p) for p in points] == [
        ("2026-06", 0, 100, 6_400),
        ("2026-07", 0, 0, 6_400),
    ]


def test_months_after_the_window_add_to_the_last_net_only_never_to_the_flows() -> None:
    # Movements dated in the future still count in the balance of today, which is the last point.
    totals = {
        "2026-10": _totals(income=1_000),
        "2026-11": _totals(expense=100),
        "2026-12": _totals(expense=40),
        "2030-01": _totals(income=5),
    }

    points = build_points(totals, ["2026-10", "2026-11"])

    assert [_row(p) for p in points] == [
        ("2026-10", 1_000, 0, 1_000),
        # 1.000 - 100 - 40 + 5: the future is in today's balance, and in no flow.
        ("2026-11", 0, 100, 865),
    ]


def test_the_order_of_the_totals_does_not_matter() -> None:
    forward = {"2026-09": _totals(income=3), "2026-10": _totals(expense=1)}
    backward = dict(reversed(forward.items()))

    window = ["2026-09", "2026-10"]
    assert build_points(forward, window) == build_points(backward, window)


def test_a_window_of_one_month_has_the_opening_and_the_future_in_its_net() -> None:
    totals = {"2026-10": _totals(income=70), "2026-11": _totals(income=5), "2027-01": _totals(3)}

    points = build_points(totals, ["2026-11"])

    assert [_row(p) for p in points] == [("2026-11", 5, 0, 78)]

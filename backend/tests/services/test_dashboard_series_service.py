"""`dashboard.service.get_series` (KAN-90) on a real database, with the clock injected.

The router passes `now`; here each test picks it, so the window of months, its timezone edges and
the end of the year are exact and never depend on the day the suite runs.
"""

import uuid
from datetime import UTC, date, datetime
from typing import Any

import pytest
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from app.modules.dashboard import service
from app.modules.dashboard.schemas import DashboardSeriesRead
from app.modules.transactions import service as transactions_service
from app.modules.transactions.schemas import TransactionFilters
from tests.transactions_helpers import (
    insert_adjustment,
    insert_expense,
    insert_income,
    insert_transfer,
    make_account,
    make_category,
    make_user_and_space,
)

# 15 November 2026, noon in Montevideo (UTC-3): the current month is 2026-11.
NOW = datetime(2026, 11, 15, 15, 0, tzinfo=UTC)

# (month, income, expense, net) of every point
Row = tuple[str, int, int, int]


async def _series(
    session: AsyncSession, space_id: uuid.UUID, months: int = 6, now: datetime = NOW
) -> DashboardSeriesRead:
    return await service.get_series(session, space_id, months, now=now)


def _rows(series: DashboardSeriesRead) -> list[Row]:
    return [(p.month, p.income_minor, p.expense_minor, p.net_minor) for p in series.points]


# the window ------------------------------------------------------------------------------------


async def test_a_space_without_movements_has_six_months_of_zeros_ending_in_the_current_one(
    session: AsyncSession,
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")

    series = await _series(session, space_id)

    assert _rows(series) == [
        ("2026-06", 0, 0, 0),
        ("2026-07", 0, 0, 0),
        ("2026-08", 0, 0, 0),
        ("2026-09", 0, 0, 0),
        ("2026-10", 0, 0, 0),
        ("2026-11", 0, 0, 0),
    ]


@pytest.mark.parametrize(("months", "first"), [(1, "2026-11"), (6, "2026-06"), (12, "2025-12")])
async def test_the_window_has_the_asked_number_of_months_ending_in_the_current_one(
    session: AsyncSession, months: int, first: str
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")

    series = await _series(session, space_id, months)

    assert len(series.points) == months
    assert (series.points[0].month, series.points[-1].month) == (first, "2026-11")


# income, expense and net per month -------------------------------------------------------------


async def test_each_month_has_its_income_and_expense_and_the_net_at_its_close(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Comida")
    salary = await make_category(session, space_id, name="Sueldo", kind="income")
    await insert_adjustment(session, space_id, user_id, bank.id, 10_000, day=date(2026, 6, 5))
    await insert_income(
        session, space_id, user_id, bank.id, salary.id, 5_000, day=date(2026, 8, 10)
    )
    await insert_expense(session, space_id, user_id, bank.id, food.id, 1_200, day=date(2026, 8, 20))
    await insert_expense(session, space_id, user_id, bank.id, food.id, 800, day=date(2026, 9, 3))
    await insert_income(session, space_id, user_id, bank.id, salary.id, 100, day=date(2026, 11, 2))
    await insert_expense(session, space_id, user_id, bank.id, food.id, 50, day=date(2026, 11, 9))

    series = await _series(session, space_id)

    assert _rows(series) == [
        ("2026-06", 0, 0, 10_000),
        ("2026-07", 0, 0, 10_000),  # no movements: no flows, the net stays
        ("2026-08", 5_000, 1_200, 13_800),
        ("2026-09", 0, 800, 13_000),
        ("2026-10", 0, 0, 13_000),
        ("2026-11", 100, 50, 13_050),
    ]


async def test_several_movements_of_the_same_month_add_up(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, type_="cash", name="Billetera")
    food = await make_category(session, space_id, name="Comida")
    salary = await make_category(session, space_id, name="Sueldo", kind="income")
    for day, amount in ((date(2026, 11, 1), 10), (date(2026, 11, 30), 20)):
        await insert_expense(session, space_id, user_id, bank.id, food.id, amount, day=day)
        await insert_expense(session, space_id, user_id, cash.id, food.id, amount, day=day)
        await insert_income(session, space_id, user_id, cash.id, salary.id, amount, day=day)

    series = await _series(session, space_id, 1)

    # Income: 10 + 20 on the cash account. Expense: 10 + 10 on 1 November and 20 + 20 on the 30th.
    assert _rows(series) == [("2026-11", 30, 60, -30)]


async def test_the_first_and_last_day_of_a_month_belong_to_that_month(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Comida")
    for day, amount in (
        (date(2026, 9, 30), 1),
        (date(2026, 10, 1), 10),
        (date(2026, 10, 31), 100),
        (date(2026, 11, 1), 1_000),
    ):
        await insert_expense(session, space_id, user_id, bank.id, food.id, amount, day=day)

    series = await _series(session, space_id, 3)

    assert _rows(series) == [
        ("2026-09", 0, 1, -1),
        ("2026-10", 0, 110, -111),
        ("2026-11", 0, 1_000, -1_111),
    ]


async def test_months_before_the_first_movement_have_a_net_of_zero(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    await insert_adjustment(session, space_id, user_id, bank.id, 2_500, day=date(2026, 10, 12))

    series = await _series(session, space_id)

    assert [p.net_minor for p in series.points] == [0, 0, 0, 0, 2_500, 2_500]


async def test_movements_older_than_the_window_are_in_the_opening_net_but_not_in_the_flows(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Comida")
    salary = await make_category(session, space_id, name="Sueldo", kind="income")
    await insert_adjustment(session, space_id, user_id, bank.id, 7_000, day=date(2020, 1, 15))
    await insert_income(session, space_id, user_id, bank.id, salary.id, 900, day=date(2025, 12, 31))
    # The last day before a window of 11 months (it starts in 2026-01) and the first one in it.
    await insert_expense(session, space_id, user_id, bank.id, food.id, 500, day=date(2025, 12, 31))
    await insert_expense(session, space_id, user_id, bank.id, food.id, 100, day=date(2026, 1, 1))

    series = await _series(session, space_id, 11)

    assert series.points[0].month == "2026-01"
    assert _rows(series)[0] == ("2026-01", 0, 100, 7_000 + 900 - 500 - 100)
    assert {p.income_minor for p in series.points} == {0}
    assert sum(p.expense_minor for p in series.points) == 100


# what does not count as income or expense ------------------------------------------------------


async def test_an_adjustment_changes_the_net_but_not_the_income_or_the_expense(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    await insert_adjustment(session, space_id, user_id, bank.id, 9_000, day=date(2026, 10, 3))
    await insert_adjustment(session, space_id, user_id, bank.id, -4_000, day=date(2026, 11, 3))

    series = await _series(session, space_id, 2)

    assert _rows(series) == [("2026-10", 0, 0, 9_000), ("2026-11", 0, 0, 5_000)]


async def test_a_transfer_is_neither_income_nor_expense_and_does_not_change_the_net(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    await insert_adjustment(session, space_id, user_id, bank.id, 10_000, day=date(2026, 10, 1))
    await insert_adjustment(session, space_id, user_id, card.id, -3_000, day=date(2026, 10, 1))
    # Paying the card: money leaves the bank and the debt goes down. The net is the same.
    await insert_transfer(
        session, space_id, user_id, bank.id, card.id, 2_000, day=date(2026, 11, 5)
    )

    series = await _series(session, space_id, 2)

    assert _rows(series) == [("2026-10", 0, 0, 7_000), ("2026-11", 0, 0, 7_000)]


async def test_an_expense_on_a_credit_card_is_an_expense_and_lowers_the_net(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    food = await make_category(session, space_id, name="Comida")
    await insert_adjustment(session, space_id, user_id, bank.id, 10_000, day=date(2026, 10, 1))
    await insert_expense(session, space_id, user_id, card.id, food.id, 4_000, day=date(2026, 11, 3))

    series = await _series(session, space_id, 2)

    assert _rows(series) == [("2026-10", 0, 0, 10_000), ("2026-11", 0, 4_000, 6_000)]


async def test_the_net_can_be_negative_when_the_debt_is_larger_than_what_is_available(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    await insert_adjustment(session, space_id, user_id, bank.id, 1_000, day=date(2026, 11, 1))
    await insert_adjustment(session, space_id, user_id, card.id, -6_000, day=date(2026, 11, 1))

    series = await _series(session, space_id, 1)

    assert series.points[0].net_minor == -5_000


async def test_a_deleted_movement_counts_nowhere(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Comida")
    salary = await make_category(session, space_id, name="Sueldo", kind="income")
    day = date(2026, 10, 10)
    await insert_adjustment(session, space_id, user_id, bank.id, 1_000, day=day)
    await insert_expense(session, space_id, user_id, bank.id, food.id, 10, day=day)
    await insert_expense(session, space_id, user_id, bank.id, food.id, 20, day=day, deleted_at=NOW)
    await insert_income(session, space_id, user_id, bank.id, salary.id, 30, day=day, deleted_at=NOW)
    await insert_adjustment(session, space_id, user_id, bank.id, 40, day=day, deleted_at=NOW)

    series = await _series(session, space_id, 2)

    assert _rows(series) == [("2026-10", 0, 10, 990), ("2026-11", 0, 0, 990)]


async def test_pending_and_skipped_movements_count_nowhere(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Comida")
    day = date(2026, 11, 10)
    await insert_adjustment(session, space_id, user_id, bank.id, 1_000, day=day)
    await insert_expense(session, space_id, user_id, bank.id, food.id, 7, day=day, status="pending")
    await insert_expense(
        session, space_id, user_id, bank.id, food.id, 70, day=day, status="skipped"
    )
    await insert_adjustment(session, space_id, user_id, bank.id, 700, day=day, status="pending")

    series = await _series(session, space_id, 1)

    assert _rows(series) == [("2026-11", 0, 0, 1_000)]


async def test_an_archived_account_keeps_its_history_in_the_flows_and_in_the_net(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    old = await make_account(session, space_id, name="Vieja", archived=True)
    food = await make_category(session, space_id, name="Comida")
    await insert_adjustment(session, space_id, user_id, old.id, 5_000, day=date(2026, 8, 5))
    await insert_expense(session, space_id, user_id, old.id, food.id, 1_000, day=date(2026, 9, 5))

    series = await _series(session, space_id)

    assert _rows(series)[1:5] == [
        ("2026-07", 0, 0, 0),
        ("2026-08", 0, 0, 5_000),
        ("2026-09", 0, 1_000, 4_000),
        ("2026-10", 0, 0, 4_000),
    ]


async def test_an_account_created_in_the_middle_of_the_period_steps_the_net_in_its_month(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    savings = await make_account(session, space_id, name="Ahorro")
    await insert_adjustment(session, space_id, user_id, bank.id, 10_000, day=date(2026, 6, 1))
    # The initial balance of the second account is an adjustment dated the day it was created.
    await insert_adjustment(session, space_id, user_id, savings.id, 20_000, day=date(2026, 9, 12))

    series = await _series(session, space_id)

    assert [p.net_minor for p in series.points] == [10_000, 10_000, 10_000, 30_000, 30_000, 30_000]


# movements dated in the future -----------------------------------------------------------------


async def test_a_future_movement_is_in_no_flow_but_it_is_in_the_net_of_today(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Comida")
    salary = await make_category(session, space_id, name="Sueldo", kind="income")
    await insert_adjustment(session, space_id, user_id, bank.id, 5_000, day=date(2026, 11, 1))
    await insert_expense(session, space_id, user_id, bank.id, food.id, 700, day=date(2026, 12, 20))
    await insert_income(session, space_id, user_id, bank.id, salary.id, 40, day=date(2030, 1, 1))

    series = await _series(session, space_id, 2)

    # The last point is the balance of today, which counts what is already confirmed.
    assert _rows(series) == [("2026-10", 0, 0, 0), ("2026-11", 0, 0, 5_000 - 700 + 40)]
    summary = await transactions_service.get_balance_summary(session, space_id)
    assert series.points[-1].net_minor == summary.net_minor


# the timezone of the space ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("timezone", "expected"),
    [
        # Montevideo is UTC-3: at 01:00 UTC of 1 November it is still the night of 31 October.
        # The current month is October and the income dated 1 November is in the future: in no
        # flow, but in the balance of today.
        (
            "America/Montevideo",
            [("2026-09", 0, 0, 0), ("2026-10", 0, 100, 910)],
        ),
        # Auckland is UTC+13 in summer: the same instant is the afternoon of 1 November. October
        # closed with the income of 1 November out of its net.
        (
            "Pacific/Auckland",
            [("2026-10", 0, 100, 900), ("2026-11", 10, 0, 910)],
        ),
    ],
)
async def test_the_close_of_the_month_follows_the_timezone_of_the_space(
    session: AsyncSession, timezone: str, expected: list[Row]
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a", timezone=timezone)
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Comida")
    salary = await make_category(session, space_id, name="Sueldo", kind="income")
    await insert_adjustment(session, space_id, user_id, bank.id, 1_000, day=date(2026, 10, 30))
    await insert_expense(session, space_id, user_id, bank.id, food.id, 100, day=date(2026, 10, 31))
    await insert_income(session, space_id, user_id, bank.id, salary.id, 10, day=date(2026, 11, 1))

    series = await _series(session, space_id, 2, now=datetime(2026, 11, 1, 1, 0, tzinfo=UTC))

    assert _rows(series) == expected


@pytest.mark.parametrize(
    ("timezone", "now", "expected"),
    [
        # The last evening of the year in Montevideo is already January in UTC.
        (
            "America/Montevideo",
            datetime(2027, 1, 1, 1, 0, tzinfo=UTC),
            [("2026-11", 0, 0, 0), ("2026-12", 0, 10, -1_010)],
        ),
        # ... and in Auckland it is the first morning of the new year.
        (
            "Pacific/Auckland",
            datetime(2026, 12, 31, 12, 0, tzinfo=UTC),
            [("2026-12", 0, 10, -10), ("2027-01", 0, 1_000, -1_010)],
        ),
    ],
)
async def test_the_window_crosses_the_end_of_the_year_in_the_timezone_of_the_space(
    session: AsyncSession, timezone: str, now: datetime, expected: list[Row]
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a", timezone=timezone)
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Comida")
    await insert_expense(session, space_id, user_id, bank.id, food.id, 10, day=date(2026, 12, 31))
    await insert_expense(session, space_id, user_id, bank.id, food.id, 1_000, day=date(2027, 1, 1))

    series = await _series(session, space_id, 2, now=now)

    assert _rows(series) == expected


async def test_the_months_do_not_depend_on_the_timezone_of_the_database_session(
    session: AsyncSession,
) -> None:
    """`date` has no timezone: grouping it must not move a day to another month."""
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Comida")
    await insert_expense(session, space_id, user_id, bank.id, food.id, 10, day=date(2026, 10, 31))
    await insert_expense(session, space_id, user_id, bank.id, food.id, 100, day=date(2026, 11, 1))
    expected = _rows(await _series(session, space_id))

    for zone in ("Pacific/Kiritimati", "America/Los_Angeles", "UTC"):
        await session.execute(text(f"SET LOCAL TIME ZONE '{zone}'"))
        assert _rows(await _series(session, space_id)) == expected, zone

    assert expected[-2:] == [("2026-10", 0, 10, -10), ("2026-11", 0, 100, -110)]


# the series says what the rest of the API says -------------------------------------------------


async def test_the_series_agrees_with_the_balances_the_dashboard_and_the_movements_summary(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, type_="cash", name="Billetera")
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    food = await make_category(session, space_id, name="Comida")
    salary = await make_category(session, space_id, name="Sueldo", kind="income")

    def on(month: int, day: int) -> dict[str, Any]:
        return {"day": date(2026, month, day)}

    await insert_adjustment(session, space_id, user_id, bank.id, 100_000, **on(3, 2))
    await insert_adjustment(session, space_id, user_id, cash.id, 5_000, **on(5, 10))
    await insert_adjustment(session, space_id, user_id, card.id, -20_000, **on(6, 1))
    await insert_income(session, space_id, user_id, bank.id, salary.id, 30_000, **on(7, 5))
    await insert_expense(session, space_id, user_id, card.id, food.id, 7_000, **on(8, 2))
    await insert_transfer(session, space_id, user_id, bank.id, card.id, 4_000, **on(8, 20))
    await insert_expense(session, space_id, user_id, cash.id, food.id, 1_500, **on(9, 9))
    await insert_adjustment(session, space_id, user_id, bank.id, -2_500, **on(10, 3))
    await insert_expense(session, space_id, user_id, bank.id, food.id, 900, **on(11, 4))
    await insert_income(session, space_id, user_id, cash.id, salary.id, 120, **on(11, 12))

    series = await _series(session, space_id, 9)  # March to November

    balances = await transactions_service.get_balance_summary(session, space_id)
    dashboard = await service.get_dashboard(session, space_id, now=NOW)
    last = series.points[-1]
    assert last.net_minor == balances.net_minor == dashboard.net_minor
    assert last.expense_minor == dashboard.month_expense_minor == 900
    previous_net = 0
    for point in series.points:
        month_summary = await transactions_service.get_movements_summary(
            session, space_id, TransactionFilters(month=point.month)
        )
        assert point.income_minor == month_summary.income_minor, point.month
        assert point.expense_minor == month_summary.expense_minor, point.month
        # What each account moved in the month adds up to what the net moved.
        moved = 0
        for account in (bank, cash, card):
            by_account = await transactions_service.get_movements_summary(
                session, space_id, TransactionFilters(month=point.month, account_id=account.id)
            )
            moved += by_account.balance_change_minor or 0
        assert point.net_minor - previous_net == moved, point.month
        previous_net = point.net_minor


async def test_the_movements_of_another_space_never_get_in(session: AsyncSession) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    user_b, space_b = await make_user_and_space(session, "uid-b")
    account_a = await make_account(session, space_a)
    account_b = await make_account(session, space_b)
    food_a = await make_category(session, space_a, name="Comida")
    food_b = await make_category(session, space_b, name="Comida")
    await insert_adjustment(session, space_a, user_a, account_a.id, 424_242, day=date(2026, 11, 1))
    await insert_expense(
        session, space_a, user_a, account_a.id, food_a.id, 31_337, day=date(2026, 11, 2)
    )
    await insert_expense(
        session, space_b, user_b, account_b.id, food_b.id, 40, day=date(2026, 11, 2)
    )

    series = await _series(session, space_b, 1)

    assert _rows(series) == [("2026-11", 0, 40, -40)]


# the queries -----------------------------------------------------------------------------------


async def test_the_series_runs_exactly_two_statements_whatever_the_data_and_the_months(
    session: AsyncSession, db_connection: AsyncConnection
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    food = await make_category(session, space_id, name="Comida")
    await insert_expense(
        session, space_id, user_id, account.id, food.id, 100, day=date(2026, 11, 3)
    )
    statements: list[str] = []

    def count(*args: Any) -> None:
        statements.append(str(args[2]))

    event.listen(db_connection.sync_connection, "before_cursor_execute", count)
    try:
        counts: list[int] = []
        for months in (1, 12):
            statements.clear()
            await _series(session, space_id, months)
            counts.append(len(statements))
        for month in range(1, 12):
            for day in (3, 17, 28):
                await insert_expense(
                    session, space_id, user_id, card.id, food.id, 5, day=date(2026, month, day)
                )
                await insert_adjustment(
                    session, space_id, user_id, account.id, -7, day=date(2025, month, day)
                )
        for months in (1, 12):
            statements.clear()
            await _series(session, space_id, months)
            counts.append(len(statements))
    finally:
        event.remove(db_connection.sync_connection, "before_cursor_execute", count)

    # The timezone of the space and one aggregate over the entries: two, with 1 or 12 months and
    # with one movement or a hundred.
    assert counts == [2, 2, 2, 2]


async def test_a_window_of_zero_months_is_a_bug_of_the_caller(session: AsyncSession) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")

    with pytest.raises(ValueError, match="at least one"):
        await _series(session, space_id, 0)

"""`dashboard.service.get_dashboard` (KAN-81) on a real database, with the clock injected.

The router passes `now`; here each test picks it, so the month in the space's timezone and the
edges of the month are exact and never depend on the day the suite runs.
"""

import uuid
from datetime import UTC, date, datetime
from typing import Any

import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from app.modules.accounts import service as accounts_service
from app.modules.categories import service as categories_service
from app.modules.dashboard import service
from app.modules.dashboard.schemas import DashboardRead
from app.modules.transactions import service as transactions_service
from app.modules.transactions.schemas import ExpenseCreate
from tests.transactions_helpers import (
    insert_adjustment,
    insert_expense,
    insert_income,
    insert_transaction,
    insert_transfer,
    make_account,
    make_category,
    make_user_and_space,
)

# 15 November 2026, noon in Montevideo (UTC-3): the current month is 2026-11.
NOW = datetime(2026, 11, 15, 15, 0, tzinfo=UTC)
NOV_10 = date(2026, 11, 10)


async def _dashboard(
    session: AsyncSession, space_id: uuid.UUID, now: datetime = NOW
) -> DashboardRead:
    return await service.get_dashboard(session, space_id, now=now)


def _rows(dashboard: DashboardRead) -> list[tuple[str, int, int]]:
    """`(name, amount, percentage)` of every row of the top."""
    return [(r.name, r.amount_minor, r.percentage) for r in dashboard.top_expense_categories]


# an empty space ---------------------------------------------------------------------------------


async def test_a_space_without_movements_is_all_zeros_and_has_the_current_month(
    session: AsyncSession,
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")

    dashboard = await _dashboard(session, space_id)

    assert dashboard.model_dump() == {
        "month": "2026-11",
        "available_minor": 0,
        "card_debt_minor": 0,
        "net_minor": 0,
        "month_expense_minor": 0,
        "top_expense_categories": [],
    }


# available, debt and net ------------------------------------------------------------------------


async def test_available_debt_and_net_split_the_accounts_like_the_balance_summary(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, type_="cash", name="Billetera")
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    await insert_adjustment(session, space_id, user_id, bank.id, 100_000)
    await insert_adjustment(session, space_id, user_id, cash.id, 2_500)
    await insert_adjustment(session, space_id, user_id, card.id, -30_000)

    dashboard = await _dashboard(session, space_id)

    assert (dashboard.available_minor, dashboard.card_debt_minor, dashboard.net_minor) == (
        102_500,
        30_000,
        72_500,
    )
    summary = await transactions_service.get_balance_summary(session, space_id)
    assert (dashboard.available_minor, dashboard.card_debt_minor, dashboard.net_minor) == (
        summary.available_minor,
        summary.card_debt_minor,
        summary.net_minor,
    )


async def test_the_three_figures_are_the_sum_of_the_balances_of_the_accounts(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, type_="cash", name="Billetera")
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    food = await make_category(session, space_id)
    await insert_adjustment(session, space_id, user_id, bank.id, 50_000)
    await insert_expense(session, space_id, user_id, card.id, food.id, 4_000, day=NOV_10)
    await insert_transfer(session, space_id, user_id, bank.id, card.id, 1_500, day=NOV_10)
    await insert_expense(session, space_id, user_id, cash.id, food.id, 300, day=NOV_10)

    dashboard = await _dashboard(session, space_id)

    balances = await transactions_service.get_account_balances(session, space_id)
    accounts = await accounts_service.list_accounts(session, space_id, include_archived=True)
    in_cash = sum(balances.get(a.id, 0) for a in accounts if a.type in ("bank", "cash"))
    on_cards = sum(balances.get(a.id, 0) for a in accounts if a.type == "credit_card")
    assert dashboard.available_minor == in_cash
    assert dashboard.card_debt_minor == -on_cards
    assert dashboard.net_minor == in_cash + on_cards == sum(balances.values())


async def test_a_card_paid_in_excess_has_a_negative_debt_that_is_not_clamped(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    await insert_adjustment(session, space_id, user_id, bank.id, 10_000)
    await insert_transfer(session, space_id, user_id, bank.id, card.id, 1_000)

    dashboard = await _dashboard(session, space_id)

    assert (dashboard.available_minor, dashboard.card_debt_minor, dashboard.net_minor) == (
        9_000,
        -1_000,
        10_000,
    )


async def test_an_archived_account_still_counts_in_the_figures(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    old = await make_account(session, space_id, name="Vieja", archived=True)
    await insert_adjustment(session, space_id, user_id, old.id, 500)

    dashboard = await _dashboard(session, space_id)

    assert (dashboard.available_minor, dashboard.net_minor) == (500, 500)


async def test_pending_skipped_and_deleted_movements_do_not_touch_the_figures(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    await insert_adjustment(session, space_id, user_id, bank.id, 1_000)
    await insert_adjustment(session, space_id, user_id, bank.id, 7, status="pending")
    await insert_adjustment(session, space_id, user_id, bank.id, 70, status="skipped")
    await insert_adjustment(session, space_id, user_id, bank.id, 700, deleted_at=NOW)

    dashboard = await _dashboard(session, space_id)

    assert (dashboard.available_minor, dashboard.card_debt_minor, dashboard.net_minor) == (
        1_000,
        0,
        1_000,
    )


# the top of the month ---------------------------------------------------------------------------


async def test_the_top_adds_subcategories_to_their_main_category_over_several_months(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Comida")
    market = await make_category(session, space_id, name="Supermercado", parent_id=food.id)
    restaurants = await make_category(session, space_id, name="Restaurantes", parent_id=food.id)
    transport = await make_category(session, space_id, name="Transporte")
    health = await make_category(session, space_id, name="Salud")
    trips = await make_category(session, space_id, name="Viajes")

    def spend(category_id: uuid.UUID, amount: int, day: date) -> Any:
        return insert_expense(session, space_id, user_id, account.id, category_id, amount, day=day)

    # November: the month in progress.
    await spend(food.id, 1_000, date(2026, 11, 2))
    await spend(market.id, 2_500, date(2026, 11, 8))
    await spend(restaurants.id, 500, date(2026, 11, 20))
    await spend(transport.id, 2_000, date(2026, 11, 5))
    await spend(health.id, 1_500, date(2026, 11, 12))
    # Other months: they must not leak in, whatever their size.
    await spend(trips.id, 90_000, date(2026, 10, 31))
    await spend(food.id, 80_000, date(2026, 10, 15))
    await spend(trips.id, 70_000, date(2026, 12, 1))
    await spend(transport.id, 60_000, date(2025, 11, 10))

    dashboard = await _dashboard(session, space_id)

    assert dashboard.month_expense_minor == 7_500
    assert _rows(dashboard) == [
        ("Comida", 4_000, 53),  # 53.33
        ("Transporte", 2_000, 27),  # 26.67
        ("Salud", 1_500, 20),
    ]
    assert dashboard.top_expense_categories[0].category_id == food.id
    assert dashboard.top_expense_categories[0].icon == "fork-knife"


async def test_only_the_five_largest_main_categories_are_listed_and_the_rest_is_in_the_total(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    amounts = {"A": 4_000, "B": 2_000, "C": 1_500, "D": 1_000, "E": 800, "F": 600}
    for name, amount in amounts.items():
        category = await make_category(session, space_id, name=name)
        await insert_expense(
            session, space_id, user_id, account.id, category.id, amount, day=NOV_10
        )

    dashboard = await _dashboard(session, space_id)

    assert dashboard.month_expense_minor == 9_900
    assert _rows(dashboard) == [
        ("A", 4_000, 40),  # 40.40
        ("B", 2_000, 20),  # 20.20
        ("C", 1_500, 15),  # 15.15
        ("D", 1_000, 10),  # 10.10
        ("E", 800, 8),  # 8.08
    ]
    # The percentages are over the whole month, so the five do not add up to 100.
    assert sum(r.percentage for r in dashboard.top_expense_categories) == 93


async def test_the_percentage_rounds_the_half_up(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    big = await make_category(session, space_id, name="Grande")
    small = await make_category(session, space_id, name="Chico")
    await insert_expense(session, space_id, user_id, account.id, big.id, 700, day=NOV_10)
    await insert_expense(session, space_id, user_id, account.id, small.id, 100, day=NOV_10)

    dashboard = await _dashboard(session, space_id)

    # 87.5 % and 12.5 %: both halves go up, so the two add up to 101. Accepted and documented.
    assert _rows(dashboard) == [("Grande", 700, 88), ("Chico", 100, 13)]


async def test_a_single_category_is_one_hundred_percent(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Comida")
    await insert_expense(session, space_id, user_id, account.id, food.id, 333, day=NOV_10)

    assert _rows(await _dashboard(session, space_id)) == [("Comida", 333, 100)]


async def test_an_archived_main_category_and_its_archived_subcategory_still_count(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Comida")
    market = await make_category(session, space_id, name="Supermercado", parent_id=food.id)
    old = await make_category(session, space_id, name="Antigua")
    await insert_expense(session, space_id, user_id, account.id, market.id, 300, day=NOV_10)
    await insert_expense(session, space_id, user_id, account.id, old.id, 100, day=NOV_10)
    # Archiving a main category takes its subcategories with it; old movements keep them all.
    await categories_service.archive_category(session, space_id, food.id)
    await categories_service.archive_category(session, space_id, old.id)

    dashboard = await _dashboard(session, space_id)

    assert _rows(dashboard) == [("Comida", 300, 75), ("Antigua", 100, 25)]


async def test_incomes_transfers_adjustments_pending_skipped_and_deleted_are_not_in_the_top(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    other = await make_account(session, space_id, type_="cash", name="Billetera")
    food = await make_category(session, space_id, name="Comida")
    salary = await make_category(session, space_id, name="Sueldo", kind="income")
    await insert_expense(session, space_id, user_id, account.id, food.id, 100, day=NOV_10)
    await insert_income(session, space_id, user_id, account.id, salary.id, 50_000, day=NOV_10)
    await insert_transfer(session, space_id, user_id, account.id, other.id, 9_000, day=NOV_10)
    await insert_adjustment(session, space_id, user_id, account.id, -8_000, day=NOV_10)
    await insert_expense(
        session, space_id, user_id, account.id, food.id, 7, day=NOV_10, status="pending"
    )
    await insert_expense(
        session, space_id, user_id, account.id, food.id, 70, day=NOV_10, status="skipped"
    )
    await insert_expense(
        session, space_id, user_id, account.id, food.id, 700, day=NOV_10, deleted_at=NOW
    )

    dashboard = await _dashboard(session, space_id)

    assert dashboard.month_expense_minor == 100
    assert _rows(dashboard) == [("Comida", 100, 100)]


async def test_a_deleted_expense_leaves_the_top_and_comes_back_when_restored(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Comida")
    transport = await make_category(session, space_id, name="Transporte")
    kept = await transactions_service.create_transaction(
        session,
        space_id,
        user_id,
        ExpenseCreate(
            type="expense",
            date=NOV_10,
            account_id=account.id,
            category_id=food.id,
            amount_minor=100,
        ),
    )
    gone = await transactions_service.create_transaction(
        session,
        space_id,
        user_id,
        ExpenseCreate(
            type="expense",
            date=NOV_10,
            account_id=account.id,
            category_id=transport.id,
            amount_minor=300,
        ),
    )
    assert kept.id != gone.id

    await transactions_service.delete_transaction(session, space_id, gone.id, now=NOW)
    assert _rows(await _dashboard(session, space_id)) == [("Comida", 100, 100)]

    await transactions_service.restore_transaction(session, space_id, gone.id, now=NOW)
    assert _rows(await _dashboard(session, space_id)) == [
        ("Transporte", 300, 75),
        ("Comida", 100, 25),
    ]


async def test_the_whole_month_counts_including_the_days_after_today(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Comida")
    for day in (date(2026, 11, 1), NOW.date(), date(2026, 11, 30)):
        await insert_expense(session, space_id, user_id, account.id, food.id, 10, day=day)

    assert (await _dashboard(session, space_id)).month_expense_minor == 30


async def test_the_spending_of_another_space_with_the_same_category_names_is_not_mixed_in(
    session: AsyncSession,
) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    user_b, space_b = await make_user_and_space(session, "uid-b")
    account_a = await make_account(session, space_a)
    account_b = await make_account(session, space_b)
    food_a = await make_category(session, space_a, name="Comida")
    food_b = await make_category(session, space_b, name="Comida")
    await insert_expense(session, space_a, user_a, account_a.id, food_a.id, 900, day=NOV_10)
    await insert_expense(session, space_b, user_b, account_b.id, food_b.id, 40, day=NOV_10)
    await insert_adjustment(session, space_a, user_a, account_a.id, 5_000)

    dashboard = await _dashboard(session, space_b)

    assert dashboard.month_expense_minor == 40
    assert _rows(dashboard) == [("Comida", 40, 100)]
    assert dashboard.top_expense_categories[0].category_id == food_b.id
    assert (dashboard.available_minor, dashboard.net_minor) == (-40, -40)


# the month in the timezone of the space ----------------------------------------------------------


@pytest.mark.parametrize(
    ("timezone", "now", "month", "counted_day", "left_out_day"),
    [
        # Montevideo is UTC-3: at 01:30 UTC of 1 December it is still 30 November.
        (
            "America/Montevideo",
            datetime(2026, 12, 1, 1, 30, tzinfo=UTC),
            "2026-11",
            date(2026, 11, 30),
            date(2026, 12, 1),
        ),
        # ... and at 03:00 UTC it is midnight of 1 December.
        (
            "America/Montevideo",
            datetime(2026, 12, 1, 3, 0, tzinfo=UTC),
            "2026-12",
            date(2026, 12, 1),
            date(2026, 11, 30),
        ),
        # Auckland is UTC+13 in summer: at noon UTC of 30 November it is already 1 December.
        (
            "Pacific/Auckland",
            datetime(2026, 11, 30, 12, 0, tzinfo=UTC),
            "2026-12",
            date(2026, 12, 1),
            date(2026, 11, 30),
        ),
        # The last evening of the year in Montevideo is already January in UTC.
        (
            "America/Montevideo",
            datetime(2027, 1, 1, 1, 0, tzinfo=UTC),
            "2026-12",
            date(2026, 12, 31),
            date(2027, 1, 1),
        ),
        # A month with a single digit is zero padded.
        (
            "America/Montevideo",
            datetime(2026, 3, 9, 12, 0, tzinfo=UTC),
            "2026-03",
            date(2026, 3, 9),
            date(2026, 2, 28),
        ),
    ],
)
async def test_the_current_month_is_the_one_of_the_space_timezone(
    session: AsyncSession,
    timezone: str,
    now: datetime,
    month: str,
    counted_day: date,
    left_out_day: date,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a", timezone=timezone)
    account = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Comida")
    await insert_expense(session, space_id, user_id, account.id, food.id, 10, day=counted_day)
    await insert_expense(session, space_id, user_id, account.id, food.id, 1_000, day=left_out_day)

    dashboard = await _dashboard(session, space_id, now)

    assert dashboard.month == month
    assert dashboard.month_expense_minor == 10
    assert _rows(dashboard) == [("Comida", 10, 100)]


# the queries ------------------------------------------------------------------------------------


async def test_the_dashboard_runs_exactly_five_statements_whatever_the_amount_of_data(
    session: AsyncSession, db_connection: AsyncConnection
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    first = await make_category(session, space_id, name="Primera")
    await insert_expense(session, space_id, user_id, account.id, first.id, 100, day=NOV_10)
    statements: list[str] = []

    def count(*args: Any) -> None:
        statements.append(str(args[2]))

    event.listen(db_connection.sync_connection, "before_cursor_execute", count)
    try:
        await _dashboard(session, space_id)
        small = len(statements)
        statements.clear()
        for i in range(30):
            category = await make_category(session, space_id, name=f"Categoría {i}")
            sub = await make_category(session, space_id, name=f"Sub {i}", parent_id=category.id)
            await insert_expense(session, space_id, user_id, account.id, sub.id, 10 + i, day=NOV_10)
            await insert_expense(
                session, space_id, user_id, card.id, category.id, 5 + i, day=NOV_10
            )
        statements.clear()
        await _dashboard(session, space_id)
        large = len(statements)
    finally:
        event.remove(db_connection.sync_connection, "before_cursor_execute", count)

    # The timezone of the space, the balances (the sums and the accounts), the spending of the
    # month per category and the categories: five, with one category or with sixty.
    assert (small, large) == (5, 5)


async def test_a_movement_of_the_month_without_a_category_counts_in_the_total_only(
    session: AsyncSession,
) -> None:
    """The API never writes one; the database allows it. The total stays equal to the summary."""
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Comida")
    await insert_expense(session, space_id, user_id, account.id, food.id, 100, day=NOV_10)
    await insert_transaction(
        session,
        space_id,
        user_id,
        entries=[(account.id, -300, None)],
        type_="expense",
        day=NOV_10,
    )

    dashboard = await _dashboard(session, space_id)

    assert dashboard.month_expense_minor == 400
    assert _rows(dashboard) == [("Comida", 100, 25)]

"""`transactions.service.get_expense_by_category` (KAN-81): the spending of a month by category."""

from datetime import UTC, date, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.transactions import service
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

NOV = "2026-11"


async def test_it_groups_the_confirmed_expenses_of_the_month_by_category_as_positive_amounts(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Comida")
    transport = await make_category(session, space_id, name="Transporte")
    await insert_expense(
        session, space_id, user_id, account.id, food.id, 1_000, day=date(2026, 11, 3)
    )
    await insert_expense(
        session, space_id, user_id, account.id, food.id, 250, day=date(2026, 11, 20)
    )
    await insert_expense(
        session, space_id, user_id, account.id, transport.id, 400, day=date(2026, 11, 9)
    )

    spent = await service.get_expense_by_category(session, space_id, NOV)

    assert spent == {food.id: 1_250, transport.id: 400}


async def test_incomes_transfers_and_adjustments_are_not_spending(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    other = await make_account(session, space_id, name="Efectivo", type_="cash")
    food = await make_category(session, space_id, name="Comida")
    salary = await make_category(session, space_id, name="Sueldo", kind="income")
    day = date(2026, 11, 10)
    await insert_expense(session, space_id, user_id, account.id, food.id, 100, day=day)
    await insert_income(session, space_id, user_id, account.id, salary.id, 9_000, day=day)
    await insert_transfer(session, space_id, user_id, account.id, other.id, 500, day=day)
    await insert_adjustment(session, space_id, user_id, account.id, -700, day=day)
    await insert_adjustment(session, space_id, user_id, account.id, 3_000, day=day)

    assert await service.get_expense_by_category(session, space_id, NOV) == {food.id: 100}


async def test_pending_skipped_and_deleted_expenses_are_not_spending(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Comida")
    day = date(2026, 11, 10)
    await insert_expense(session, space_id, user_id, account.id, food.id, 100, day=day)
    await insert_expense(
        session, space_id, user_id, account.id, food.id, 7, day=day, status="pending"
    )
    await insert_expense(
        session, space_id, user_id, account.id, food.id, 70, day=day, status="skipped"
    )
    await insert_expense(
        session,
        space_id,
        user_id,
        account.id,
        food.id,
        700,
        day=day,
        deleted_at=datetime.now(UTC),
    )

    assert await service.get_expense_by_category(session, space_id, NOV) == {food.id: 100}


async def test_only_the_days_of_the_month_count_and_both_ends_are_inside(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Comida")
    for day, amount in (
        (date(2026, 10, 31), 1),  # the day before
        (date(2026, 11, 1), 10),  # first day: inside
        (date(2026, 11, 30), 100),  # last day: inside
        (date(2026, 12, 1), 1_000),  # the day after
        (date(2025, 11, 15), 10_000),  # same month, another year
    ):
        await insert_expense(session, space_id, user_id, account.id, food.id, amount, day=day)

    assert await service.get_expense_by_category(session, space_id, NOV) == {food.id: 110}


async def test_december_ends_on_the_last_day_of_the_year(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Comida")
    await insert_expense(session, space_id, user_id, account.id, food.id, 5, day=date(2026, 12, 31))
    await insert_expense(session, space_id, user_id, account.id, food.id, 50, day=date(2027, 1, 1))

    assert await service.get_expense_by_category(session, space_id, "2026-12") == {food.id: 5}


async def test_a_month_without_spending_gives_an_empty_answer(session: AsyncSession) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")

    assert await service.get_expense_by_category(session, space_id, NOV) == {}


async def test_the_spending_of_another_space_never_shows_up(session: AsyncSession) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    _, space_b = await make_user_and_space(session, "uid-b")
    account = await make_account(session, space_a)
    food = await make_category(session, space_a, name="Comida")
    await insert_expense(session, space_a, user_a, account.id, food.id, 900, day=date(2026, 11, 5))

    assert await service.get_expense_by_category(session, space_b, NOV) == {}


async def test_an_expense_without_a_category_is_grouped_under_none(
    session: AsyncSession,
) -> None:
    """The API never writes one, but the database allows it: it must still count in the total."""
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    await insert_transaction(
        session,
        space_id,
        user_id,
        entries=[(account.id, -300, None)],
        type_="expense",
        day=date(2026, 11, 5),
    )

    assert await service.get_expense_by_category(session, space_id, NOV) == {None: 300}

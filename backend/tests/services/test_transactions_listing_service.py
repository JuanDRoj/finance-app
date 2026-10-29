"""The movements list, its summary and the detail (`transactions.service`), on a real database."""

import uuid
from datetime import date
from typing import Any

import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from app.core.errors import NotFoundError
from app.modules.transactions import service
from app.modules.transactions.models import Transaction
from app.modules.transactions.schemas import (
    MovementListItem,
    MovementPage,
    TransactionFilters,
    TransactionListFilters,
    TransactionSummaryRead,
)
from tests.transactions_helpers import (
    insert_adjustment,
    insert_expense,
    insert_income,
    insert_transfer,
    make_account,
    make_category,
    make_user_and_space,
)

OCT = date(2026, 10, 20)


def _list_filters(**fields: Any) -> TransactionListFilters:
    return TransactionListFilters.model_validate(fields)


def _filters(**fields: Any) -> TransactionFilters:
    return TransactionFilters.model_validate(fields)


async def _ids(session: AsyncSession, space_id: uuid.UUID, **fields: Any) -> list[uuid.UUID]:
    page = await service.list_movements(session, space_id, _list_filters(limit=100, **fields))
    return [item.id for item in page.items]


async def _pages(session: AsyncSession, space_id: uuid.UUID, **fields: Any) -> list[MovementPage]:
    """Follow `next_cursor` until the end."""
    pages: list[MovementPage] = []
    cursor: str | None = None
    for _ in range(100):  # a guard against a cursor that never ends
        page = await service.list_movements(
            session, space_id, _list_filters(cursor=cursor, **fields)
        )
        pages.append(page)
        cursor = page.next_cursor
        if cursor is None:
            return pages
    raise AssertionError("the cursor never ended")


async def _items(
    session: AsyncSession, space_id: uuid.UUID, **fields: Any
) -> list[MovementListItem]:
    return [item for page in await _pages(session, space_id, **fields) for item in page.items]


# paging -----------------------------------------------------------------------------------------


async def test_an_empty_space_has_an_empty_page(session: AsyncSession) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    page = await service.list_movements(session, space_id, _list_filters())
    assert page.items == []
    assert page.next_cursor is None


async def test_the_list_is_newest_date_first_and_then_newest_id_first(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    old = await insert_expense(
        session, space_id, user_id, account.id, category.id, 100, day=date(2026, 10, 1)
    )
    first_today = await insert_expense(session, space_id, user_id, account.id, category.id, 200)
    second_today = await insert_expense(session, space_id, user_id, account.id, category.id, 300)
    newest = await insert_expense(
        session, space_id, user_id, account.id, category.id, 400, day=date(2026, 10, 25)
    )
    assert await _ids(session, space_id) == [
        newest.id,
        second_today.id,
        first_today.id,
        old.id,
    ]


@pytest.mark.parametrize("limit", [1, 2, 4, 5, 7, 22, 23, 50])
async def test_pages_have_no_duplicates_and_no_gaps_when_many_movements_share_a_date(
    session: AsyncSession, limit: int
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    days = [date(2026, 10, 20)] * 9 + [date(2026, 10, 19)] * 8 + [date(2026, 10, 18)] * 6
    created: list[Transaction] = [
        await insert_expense(session, space_id, user_id, account.id, category.id, 100 + i, day=day)
        for i, day in enumerate(days)
    ]
    expected = [t.id for t in sorted(created, key=lambda t: (t.date, t.id), reverse=True)]

    pages = await _pages(session, space_id, limit=limit)

    assert [item.id for page in pages for item in page.items] == expected
    assert all(len(page.items) == limit for page in pages[:-1])
    assert 1 <= len(pages[-1].items) <= limit
    assert pages[-1].next_cursor is None
    assert all(page.next_cursor is not None for page in pages[:-1])


async def test_a_total_that_is_a_multiple_of_the_limit_has_no_empty_page_at_the_end(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    for i in range(6):
        await insert_expense(session, space_id, user_id, account.id, category.id, 100 + i)

    pages = await _pages(session, space_id, limit=3)

    assert [len(page.items) for page in pages] == [3, 3]
    assert pages[0].next_cursor is not None
    assert pages[1].next_cursor is None


async def test_a_cursor_keeps_working_after_a_newer_movement_is_added(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    for i in range(4):
        await insert_expense(session, space_id, user_id, account.id, category.id, 100 + i)
    first = await service.list_movements(session, space_id, _list_filters(limit=2))
    await insert_expense(
        session, space_id, user_id, account.id, category.id, 999, day=date(2026, 10, 30)
    )

    second = await service.list_movements(
        session, space_id, _list_filters(limit=2, cursor=first.next_cursor)
    )

    assert len(second.items) == 2
    assert {i.id for i in second.items}.isdisjoint({i.id for i in first.items})


# what the list leaves out ---------------------------------------------------------------------


async def test_deleted_movements_are_not_listed(session: AsyncSession) -> None:
    from datetime import UTC, datetime

    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    kept = await insert_expense(session, space_id, user_id, account.id, category.id, 100)
    await insert_expense(
        session, space_id, user_id, account.id, category.id, 200, deleted_at=datetime.now(UTC)
    )
    assert await _ids(session, space_id) == [kept.id]


async def test_pending_and_skipped_movements_are_listed_with_their_status(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    await insert_expense(session, space_id, user_id, account.id, category.id, 100)
    await insert_expense(session, space_id, user_id, account.id, category.id, 200, status="pending")
    await insert_expense(session, space_id, user_id, account.id, category.id, 300, status="skipped")

    items = await _items(session, space_id)

    assert sorted(item.status for item in items) == ["confirmed", "pending", "skipped"]


async def test_movements_of_another_space_are_not_listed(session: AsyncSession) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    user_b, space_b = await make_user_and_space(session, "uid-b")
    account_a = await make_account(session, space_a)
    category_a = await make_category(session, space_a)
    account_b = await make_account(session, space_b)
    category_b = await make_category(session, space_b)
    mine = await insert_expense(session, space_a, user_a, account_a.id, category_a.id, 100)
    theirs = await insert_expense(session, space_b, user_b, account_b.id, category_b.id, 200)

    assert await _ids(session, space_a) == [mine.id]
    assert await _ids(session, space_b) == [theirs.id]


# what an item shows -----------------------------------------------------------------------------


async def test_an_item_shows_the_category_with_its_icon_and_the_account(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id, name="Visa", type_="credit_card")
    main = await make_category(session, space_id, name="Ropa")
    sub = await make_category(session, space_id, name="Zapatos", parent_id=main.id)
    await insert_expense(
        session, space_id, user_id, account.id, sub.id, 4500, description="Zapatillas"
    )

    [item] = await _items(session, space_id)

    assert (item.type, item.status, item.date, item.description) == (
        "expense",
        "confirmed",
        OCT,
        "Zapatillas",
    )
    assert item.amount_minor == -4500
    assert item.category is not None
    assert (item.category.id, item.category.name, item.category.icon) == (
        sub.id,
        "Zapatos",
        "fork-knife",
    )
    assert item.category.parent is not None
    assert (item.category.parent.id, item.category.parent.name) == (main.id, "Ropa")
    assert item.account is not None
    assert (item.account.id, item.account.name, item.account.type) == (
        account.id,
        "Visa",
        "credit_card",
    )
    assert item.balance_after_minor is None


async def test_an_item_of_an_archived_account_and_category_still_shows_them(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id, archived=True)
    category = await make_category(session, space_id, archived=True)
    await insert_expense(session, space_id, user_id, account.id, category.id, 100)

    [item] = await _items(session, space_id)

    assert item.account is not None
    assert item.account.id == account.id
    assert item.category is not None
    assert item.category.id == category.id


async def test_a_transfer_and_an_adjustment_are_shown_by_their_accounts(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id, name="Itaú")
    card = await make_account(session, space_id, name="Visa", type_="credit_card")
    transfer = await insert_transfer(session, space_id, user_id, bank.id, card.id, 3000)
    adjustment = await insert_adjustment(
        session, space_id, user_id, bank.id, -700, day=date(2026, 10, 1)
    )

    items = {item.id: item for item in await _items(session, space_id)}

    moved = items[transfer.id]
    assert moved.amount_minor == 3000
    assert moved.category is None
    assert moved.account is None
    assert moved.from_account is not None
    assert moved.to_account is not None
    assert (moved.from_account.id, moved.to_account.id) == (bank.id, card.id)
    fixed = items[adjustment.id]
    assert fixed.amount_minor == -700
    assert fixed.category is None
    assert fixed.account is not None
    assert fixed.account.id == bank.id


async def test_the_list_runs_the_same_number_of_statements_whatever_the_size_of_the_page(
    session: AsyncSession, db_connection: AsyncConnection
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    other = await make_account(session, space_id, name="Efectivo", type_="cash")
    category = await make_category(session, space_id)
    for i in range(30):
        await insert_expense(session, space_id, user_id, account.id, category.id, 100 + i)
        await insert_transfer(session, space_id, user_id, account.id, other.id, 10 + i)
    statements: list[str] = []

    def count(*args: Any) -> None:
        statements.append(str(args[2]))

    event.listen(db_connection.sync_connection, "before_cursor_execute", count)
    try:
        await service.list_movements(session, space_id, _list_filters(limit=2))
        small = len(statements)
        statements.clear()
        await service.list_movements(session, space_id, _list_filters(limit=60))
        large = len(statements)
        statements.clear()
        await service.list_movements(
            session, space_id, _list_filters(limit=2, account_id=str(account.id))
        )
        small_with_balance = len(statements)
        statements.clear()
        await service.list_movements(
            session, space_id, _list_filters(limit=60, account_id=str(account.id))
        )
        large_with_balance = len(statements)
    finally:
        event.remove(db_connection.sync_connection, "before_cursor_execute", count)

    assert small == large
    assert small_with_balance == large_with_balance
    assert large <= 6


# filters ----------------------------------------------------------------------------------------


async def test_the_month_filter_covers_the_whole_month_and_nothing_else(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    by_day = {
        day: await insert_expense(session, space_id, user_id, account.id, category.id, 100, day=day)
        for day in (
            date(2026, 9, 30),
            date(2026, 10, 1),
            date(2026, 10, 15),
            date(2026, 10, 31),
            date(2026, 11, 1),
        )
    }
    in_october = [
        by_day[date(2026, 10, 31)].id,
        by_day[date(2026, 10, 15)].id,
        by_day[date(2026, 10, 1)].id,
    ]
    assert await _ids(session, space_id, month="2026-10") == in_october
    assert await _ids(session, space_id, month="2026-11") == [by_day[date(2026, 11, 1)].id]
    assert await _ids(session, space_id, month="2026-12") == []
    assert len(await _ids(session, space_id)) == 5


async def test_the_month_filter_handles_december(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    december = await insert_expense(
        session, space_id, user_id, account.id, category.id, 100, day=date(2026, 12, 31)
    )
    await insert_expense(
        session, space_id, user_id, account.id, category.id, 100, day=date(2027, 1, 1)
    )
    assert await _ids(session, space_id, month="2026-12") == [december.id]


async def test_the_type_filter_returns_only_that_type(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, name="Efectivo", type_="cash")
    expense_category = await make_category(session, space_id)
    income_category = await make_category(session, space_id, kind="income", name="Sueldo")
    by_type = {
        "expense": await insert_expense(
            session, space_id, user_id, bank.id, expense_category.id, 1
        ),
        "income": await insert_income(session, space_id, user_id, bank.id, income_category.id, 2),
        "transfer": await insert_transfer(session, space_id, user_id, bank.id, cash.id, 3),
        "adjustment": await insert_adjustment(session, space_id, user_id, bank.id, 4),
    }
    for type_, transaction in by_type.items():
        assert await _ids(session, space_id, type=type_) == [transaction.id]
    assert set(await _ids(session, space_id)) == {t.id for t in by_type.values()}


async def test_the_account_filter_includes_both_sides_of_a_transfer(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    a = await make_account(session, space_id, name="A")
    b = await make_account(session, space_id, name="B")
    c = await make_account(session, space_id, name="C")
    category = await make_category(session, space_id)
    expense_a = await insert_expense(session, space_id, user_id, a.id, category.id, 1)
    expense_b = await insert_expense(session, space_id, user_id, b.id, category.id, 2)
    a_to_b = await insert_transfer(session, space_id, user_id, a.id, b.id, 3)
    b_to_c = await insert_transfer(session, space_id, user_id, b.id, c.id, 4)

    for account, expected in (
        (a, {expense_a.id, a_to_b.id}),
        (b, {expense_b.id, a_to_b.id, b_to_c.id}),
        (c, {b_to_c.id}),
    ):
        ids = await _ids(session, space_id, account_id=str(account.id))
        assert len(ids) == len(expected)
        assert set(ids) == expected


async def test_a_main_category_includes_its_subcategories_and_a_subcategory_only_itself(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    food = await make_category(session, space_id, name="Comida")
    market = await make_category(session, space_id, name="Super", parent_id=food.id)
    old_sub = await make_category(session, space_id, name="Vieja", parent_id=food.id, archived=True)
    other = await make_category(session, space_id, name="Hogar")
    in_food = await insert_expense(session, space_id, user_id, account.id, food.id, 1)
    in_market = await insert_expense(session, space_id, user_id, account.id, market.id, 2)
    in_old_sub = await insert_expense(session, space_id, user_id, account.id, old_sub.id, 3)
    in_other = await insert_expense(session, space_id, user_id, account.id, other.id, 4)

    assert set(await _ids(session, space_id, category_id=str(food.id))) == {
        in_food.id,
        in_market.id,
        in_old_sub.id,
    }
    assert await _ids(session, space_id, category_id=str(market.id)) == [in_market.id]
    assert await _ids(session, space_id, category_id=str(other.id)) == [in_other.id]


async def test_a_filter_by_an_unknown_or_foreign_account_or_category_is_empty_not_an_error(
    session: AsyncSession,
) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    user_b, space_b = await make_user_and_space(session, "uid-b")
    account_a = await make_account(session, space_a)
    category_a = await make_category(session, space_a)
    await insert_expense(session, space_a, user_a, account_a.id, category_a.id, 100)
    account_b = await make_account(session, space_b)
    category_b = await make_category(session, space_b)
    await insert_expense(session, space_b, user_b, account_b.id, category_b.id, 100)

    for fields in (
        {"account_id": str(uuid.uuid4())},
        {"category_id": str(uuid.uuid4())},
        {"account_id": str(account_b.id)},  # an account of another space
        {"category_id": str(category_b.id)},  # a category of another space
    ):
        assert await _ids(session, space_a, **fields) == []
        summary = await service.get_movements_summary(session, space_a, _filters(**fields))
        assert summary == TransactionSummaryRead(
            count=0, income_minor=0, expense_minor=0, remaining_minor=0
        )


async def test_the_search_ignores_case_and_accents_in_both_directions(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    matching = [
        await insert_expense(
            session, space_id, user_id, account.id, category.id, 1, description=description
        )
        for description in ("Café con leche", "CAFÉ", "cafeteria lópez")
    ]
    await insert_expense(session, space_id, user_id, account.id, category.id, 1, description="Té")
    await insert_expense(session, space_id, user_id, account.id, category.id, 1)  # no description

    for text in ("cafe", "CAFE", "café", "CAFÉ", "caf", "  cafe "):
        assert set(await _ids(session, space_id, q=text)) == {t.id for t in matching}
    assert await _ids(session, space_id, q="xyz") == []


async def test_the_search_treats_percent_underscore_and_backslash_as_plain_text(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    made = {
        description: await insert_expense(
            session, space_id, user_id, account.id, category.id, 1, description=description
        )
        for description in ("100% jugo", "a_b", "axb", "ruta\\x", "otra cosa")
    }
    assert await _ids(session, space_id, q="%") == [made["100% jugo"].id]
    assert await _ids(session, space_id, q="_") == [made["a_b"].id]
    assert await _ids(session, space_id, q="a_b") == [made["a_b"].id]
    assert await _ids(session, space_id, q="\\") == [made["ruta\\x"].id]


async def test_filters_combine(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, name="Efectivo", type_="cash")
    category = await make_category(session, space_id)
    target = await insert_expense(
        session, space_id, user_id, bank.id, category.id, 1, description="Café", day=OCT
    )
    await insert_expense(  # another month
        session,
        space_id,
        user_id,
        bank.id,
        category.id,
        1,
        description="Café",
        day=date(2026, 9, 3),
    )
    await insert_expense(  # another account
        session, space_id, user_id, cash.id, category.id, 1, description="Café", day=OCT
    )
    await insert_expense(  # another description
        session, space_id, user_id, bank.id, category.id, 1, description="Pan", day=OCT
    )
    await insert_transfer(session, space_id, user_id, bank.id, cash.id, 1, description="Café")

    ids = await _ids(
        session,
        space_id,
        month="2026-10",
        type="expense",
        account_id=str(bank.id),
        category_id=str(category.id),
        q="cafe",
    )

    assert ids == [target.id]


# the summary ------------------------------------------------------------------------------------


async def test_an_empty_period_sums_zero(session: AsyncSession) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    summary = await service.get_movements_summary(session, space_id, _filters(month="2026-10"))
    assert summary == TransactionSummaryRead(
        count=0, income_minor=0, expense_minor=0, remaining_minor=0
    )


async def test_the_summary_sums_only_confirmed_expenses_and_incomes(
    session: AsyncSession,
) -> None:
    from datetime import UTC, datetime

    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    card = await make_account(session, space_id, name="Visa", type_="credit_card")
    expense_category = await make_category(session, space_id)
    income_category = await make_category(session, space_id, kind="income", name="Sueldo")
    await insert_income(session, space_id, user_id, bank.id, income_category.id, 100_000)
    await insert_expense(session, space_id, user_id, bank.id, expense_category.id, 25_000)
    await insert_expense(session, space_id, user_id, card.id, expense_category.id, 5_000)
    # None of these counts for the totals; the first four still count as rows of the table.
    await insert_adjustment(session, space_id, user_id, bank.id, 77_777)
    await insert_transfer(session, space_id, user_id, bank.id, card.id, 3_000)
    await insert_expense(
        session, space_id, user_id, bank.id, expense_category.id, 999, status="pending"
    )
    await insert_income(
        session, space_id, user_id, bank.id, income_category.id, 888, status="skipped"
    )
    await insert_expense(
        session,
        space_id,
        user_id,
        bank.id,
        expense_category.id,
        12_345,
        deleted_at=datetime.now(UTC),
    )

    summary = await service.get_movements_summary(session, space_id, _filters())

    assert summary == TransactionSummaryRead(
        count=7, income_minor=100_000, expense_minor=30_000, remaining_minor=70_000
    )


async def test_what_is_left_can_be_negative(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    expense_category = await make_category(session, space_id)
    income_category = await make_category(session, space_id, kind="income", name="Sueldo")
    await insert_income(session, space_id, user_id, account.id, income_category.id, 1_000)
    await insert_expense(session, space_id, user_id, account.id, expense_category.id, 4_000)

    summary = await service.get_movements_summary(session, space_id, _filters())

    assert (summary.income_minor, summary.expense_minor, summary.remaining_minor) == (
        1_000,
        4_000,
        -3_000,
    )


async def test_the_summary_applies_every_filter_of_the_list(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, name="Efectivo", type_="cash")
    food = await make_category(session, space_id, name="Comida")
    market = await make_category(session, space_id, name="Super", parent_id=food.id)
    home = await make_category(session, space_id, name="Hogar")
    pay = await make_category(session, space_id, kind="income", name="Sueldo")
    await insert_expense(
        session, space_id, user_id, bank.id, food.id, 100, description="Café", day=OCT
    )
    await insert_expense(
        session, space_id, user_id, bank.id, market.id, 200, description="Pan", day=OCT
    )
    await insert_expense(
        session, space_id, user_id, cash.id, home.id, 400, description="Lámpara", day=OCT
    )
    await insert_expense(
        session, space_id, user_id, bank.id, food.id, 800, description="Café", day=date(2026, 9, 1)
    )
    await insert_income(session, space_id, user_id, bank.id, pay.id, 5_000, day=OCT)
    await insert_transfer(session, space_id, user_id, bank.id, cash.id, 50, day=OCT)

    async def summary(**fields: Any) -> tuple[int, int, int, int]:
        s = await service.get_movements_summary(session, space_id, _filters(**fields))
        return s.count, s.income_minor, s.expense_minor, s.remaining_minor

    assert await summary() == (6, 5_000, 1_500, 3_500)
    assert await summary(month="2026-10") == (5, 5_000, 700, 4_300)
    # The type filter applies too: the totals match the rows of the table.
    assert await summary(month="2026-10", type="expense") == (3, 0, 700, -700)
    assert await summary(month="2026-10", type="income") == (1, 5_000, 0, 5_000)
    assert await summary(month="2026-10", type="transfer") == (1, 0, 0, 0)
    assert await summary(month="2026-10", account_id=str(cash.id)) == (2, 0, 400, -400)
    assert await summary(month="2026-10", account_id=str(bank.id)) == (4, 5_000, 300, 4_700)
    assert await summary(month="2026-10", category_id=str(food.id)) == (2, 0, 300, -300)
    assert await summary(month="2026-10", category_id=str(market.id)) == (1, 0, 200, -200)
    assert await summary(month="2026-10", q="cafe") == (1, 0, 100, -100)


# the balance after each movement ---------------------------------------------------------------


async def _balances_after(
    session: AsyncSession, space_id: uuid.UUID, **fields: Any
) -> dict[uuid.UUID, int | None]:
    return {item.id: item.balance_after_minor for item in await _items(session, space_id, **fields)}


async def test_filtering_by_account_shows_the_balance_after_each_movement(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    a = await make_account(session, space_id, name="A")
    b = await make_account(session, space_id, name="B")
    expense_category = await make_category(session, space_id)
    income_category = await make_category(session, space_id, kind="income", name="Sueldo")
    start = await insert_adjustment(
        session, space_id, user_id, a.id, 100_000, day=date(2026, 10, 1)
    )
    rent = await insert_expense(
        session, space_id, user_id, a.id, expense_category.id, 2_500, day=date(2026, 10, 5)
    )
    pay = await insert_income(
        session, space_id, user_id, a.id, income_category.id, 50_000, day=date(2026, 10, 10)
    )
    move = await insert_transfer(
        session, space_id, user_id, a.id, b.id, 10_000, day=date(2026, 10, 10)
    )
    other = await insert_expense(
        session, space_id, user_id, b.id, expense_category.id, 111, day=date(2026, 10, 11)
    )
    last = await insert_expense(
        session, space_id, user_id, a.id, expense_category.id, 300, day=date(2026, 10, 12)
    )

    on_a = await _balances_after(session, space_id, account_id=str(a.id))

    assert on_a == {
        last.id: 100_000 - 2_500 + 50_000 - 10_000 - 300,
        move.id: 100_000 - 2_500 + 50_000 - 10_000,
        pay.id: 100_000 - 2_500 + 50_000,
        rent.id: 100_000 - 2_500,
        start.id: 100_000,
    }
    assert other.id not in on_a
    on_b = await _balances_after(session, space_id, account_id=str(b.id))
    assert on_b == {other.id: 10_000 - 111, move.id: 10_000}
    # The last one of the list is the balance of the account today.
    assert on_a[last.id] == (await service.get_account_balance(session, space_id, a.id))


async def test_movements_of_the_same_day_are_ordered_by_id_for_the_balance(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    first = await insert_expense(session, space_id, user_id, account.id, category.id, 100)
    second = await insert_expense(session, space_id, user_id, account.id, category.id, 10)
    items = await _items(session, space_id, account_id=str(account.id))
    # The list is newest first, so the later id is on top and has the later balance.
    assert [item.id for item in items] == [second.id, first.id]
    assert [item.balance_after_minor for item in items] == [-110, -100]


@pytest.mark.parametrize("limit", [1, 2, 50])
async def test_the_balance_after_is_the_same_whatever_the_page_it_comes_in(
    session: AsyncSession, limit: int
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    deltas = [(-100, 1), (-250, 1), (-40, 2), (-5, 2), (-900, 3)]
    created = [
        await insert_expense(
            session, space_id, user_id, account.id, category.id, -delta, day=date(2026, 10, day)
        )
        for delta, day in deltas
    ]
    expected = {t.id: sum(d for d, _ in deltas[: i + 1]) for i, t in enumerate(created)}

    assert await _balances_after(session, space_id, account_id=str(account.id), limit=limit) == (
        expected
    )


async def test_other_filters_do_not_change_the_balance_after(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    expense_category = await make_category(session, space_id)
    income_category = await make_category(session, space_id, kind="income", name="Sueldo")
    await insert_adjustment(session, space_id, user_id, account.id, 10_000, day=date(2026, 9, 1))
    coffee = await insert_expense(
        session,
        space_id,
        user_id,
        account.id,
        expense_category.id,
        100,
        description="Café",
        day=date(2026, 10, 2),
    )
    pay = await insert_income(
        session, space_id, user_id, account.id, income_category.id, 500, day=date(2026, 10, 3)
    )
    account_filter = str(account.id)

    everything = await _balances_after(session, space_id, account_id=account_filter)

    assert everything[coffee.id] == 9_900
    assert everything[pay.id] == 10_400
    for fields in (
        {"month": "2026-10"},  # September's adjustment still counts
        {"type": "expense"},
        {"q": "cafe"},
        {"category_id": str(expense_category.id)},
    ):
        filtered = await _balances_after(session, space_id, account_id=account_filter, **fields)
        assert filtered
        assert all(everything[id_] == balance for id_, balance in filtered.items())
    assert await _balances_after(session, space_id, account_id=account_filter, q="cafe") == {
        coffee.id: 9_900
    }


async def test_a_card_balance_after_is_negative_while_there_is_debt(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    card = await make_account(session, space_id, name="Visa", type_="credit_card")
    category = await make_category(session, space_id)
    first = await insert_expense(
        session, space_id, user_id, card.id, category.id, 900, day=date(2026, 10, 1)
    )
    second = await insert_expense(
        session, space_id, user_id, card.id, category.id, 900, day=date(2026, 10, 2)
    )
    payment = await insert_transfer(
        session, space_id, user_id, bank.id, card.id, 1_800, day=date(2026, 10, 3)
    )

    assert await _balances_after(session, space_id, account_id=str(card.id)) == {
        payment.id: 0,
        second.id: -1_800,
        first.id: -900,
    }


async def test_pending_skipped_and_deleted_movements_do_not_move_the_balance_after(
    session: AsyncSession,
) -> None:
    from datetime import UTC, datetime

    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    first = await insert_expense(
        session, space_id, user_id, account.id, category.id, 100, day=date(2026, 10, 1)
    )
    pending = await insert_expense(
        session,
        space_id,
        user_id,
        account.id,
        category.id,
        5_000,
        status="pending",
        day=date(2026, 10, 2),
    )
    skipped = await insert_expense(
        session,
        space_id,
        user_id,
        account.id,
        category.id,
        6_000,
        status="skipped",
        day=date(2026, 10, 2),
    )
    await insert_expense(
        session,
        space_id,
        user_id,
        account.id,
        category.id,
        7_000,
        deleted_at=datetime.now(UTC),
        day=date(2026, 10, 2),
    )
    last = await insert_expense(
        session, space_id, user_id, account.id, category.id, 10, day=date(2026, 10, 3)
    )

    assert await _balances_after(session, space_id, account_id=str(account.id)) == {
        last.id: -110,
        pending.id: None,
        skipped.id: None,
        first.id: -100,
    }


async def test_without_an_account_filter_there_is_no_balance_after(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    await insert_expense(session, space_id, user_id, account.id, category.id, 100)
    assert set((await _balances_after(session, space_id)).values()) == {None}


async def test_a_movement_dated_in_the_past_changes_the_balance_of_the_later_ones(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    later = await insert_expense(
        session, space_id, user_id, account.id, category.id, 100, day=date(2026, 10, 10)
    )
    assert (await _balances_after(session, space_id, account_id=str(account.id)))[later.id] == -100
    await insert_expense(
        session, space_id, user_id, account.id, category.id, 40, day=date(2026, 10, 1)
    )
    assert (await _balances_after(session, space_id, account_id=str(account.id)))[later.id] == -140


# the detail ---------------------------------------------------------------------------------------


async def test_the_detail_is_the_same_as_the_item_of_the_list(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    created = await insert_expense(
        session, space_id, user_id, account.id, category.id, 1550, description="Súper"
    )

    detail = await service.get_movement(session, space_id, created.id)
    [item] = await _items(session, space_id)

    assert detail.model_dump() == item.model_dump(exclude={"balance_after_minor"})
    assert detail.amount_minor == -1550
    assert detail.description == "Súper"


async def test_the_detail_shows_a_pending_movement(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    pending = await insert_expense(
        session, space_id, user_id, account.id, category.id, 100, status="pending"
    )
    assert (await service.get_movement(session, space_id, pending.id)).status == "pending"


async def test_the_detail_of_a_deleted_other_space_or_unknown_movement_is_not_found(
    session: AsyncSession,
) -> None:
    from datetime import UTC, datetime

    user_a, space_a = await make_user_and_space(session, "uid-a")
    user_b, space_b = await make_user_and_space(session, "uid-b")
    account_a = await make_account(session, space_a)
    category_a = await make_category(session, space_a)
    account_b = await make_account(session, space_b)
    category_b = await make_category(session, space_b)
    deleted = await insert_expense(
        session, space_a, user_a, account_a.id, category_a.id, 100, deleted_at=datetime.now(UTC)
    )
    theirs = await insert_expense(session, space_b, user_b, account_b.id, category_b.id, 100)

    for transaction_id in (deleted.id, theirs.id, uuid.uuid4()):
        with pytest.raises(NotFoundError) as exc:
            await service.get_movement(session, space_a, transaction_id)
        assert exc.value.code == "transaction_not_found"

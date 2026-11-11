"""`balance_change_minor` of the summary (KAN-100) in `transactions.service`, on a real database."""

import uuid
from datetime import date
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.transactions import service
from app.modules.transactions.schemas import (
    MovementListItem,
    TransactionFilters,
    TransactionListFilters,
)
from tests.transactions_helpers import (
    insert_expense,
    insert_income,
    insert_transaction,
    make_account,
    make_category,
    make_user_and_space,
)

# The most the database accepts in one entry (`ck_entries_amount_range`), JavaScript's
# Number.MAX_SAFE_INTEGER.
MAX_ENTRY = 2**53 - 1


async def _change(session: AsyncSession, space_id: uuid.UUID, **fields: Any) -> int | None:
    summary = await service.get_movements_summary(
        session, space_id, TransactionFilters.model_validate(fields)
    )
    return summary.balance_change_minor


async def _items(
    session: AsyncSession, space_id: uuid.UUID, **fields: Any
) -> list[MovementListItem]:
    page = await service.list_movements(
        session, space_id, TransactionListFilters.model_validate({"limit": 100, **fields})
    )
    return page.items


async def test_a_transfer_with_one_account_on_both_sides_moves_nothing_and_agrees_with_the_list(
    session: AsyncSession,
) -> None:
    """The schema refuses it, but the database does not: it must still add up like the list."""
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    odd = await insert_transaction(
        session,
        space_id,
        user_id,
        entries=[(account.id, -500, None), (account.id, 500, None)],
        type_="transfer",
        day=date(2026, 10, 10),
    )
    await insert_expense(
        session, space_id, user_id, account.id, category.id, 100, day=date(2026, 10, 12)
    )

    items = await _items(session, space_id, account_id=str(account.id))

    by_id = {item.id: item.balance_after_minor for item in items}
    assert by_id[odd.id] == 0  # it nets out to zero in the running balance
    assert await _change(session, space_id, account_id=str(account.id), month="2026-10") == -100
    assert await _change(session, space_id, account_id=str(account.id), month="2026-10") == (
        items[0].balance_after_minor
    )


async def test_the_change_is_a_plain_int_up_to_the_largest_entry_the_database_accepts(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id, kind="income", name="Sueldo")
    await insert_income(
        session, space_id, user_id, account.id, category.id, MAX_ENTRY, day=date(2026, 10, 1)
    )

    change = await _change(session, space_id, account_id=str(account.id), month="2026-10")

    assert type(change) is int  # never a Decimal: SUM(bigint) is numeric in PostgreSQL
    assert change == MAX_ENTRY


async def test_two_entries_at_the_limit_add_up_exactly_without_overflowing(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id, kind="income", name="Sueldo")
    for day in (1, 2):
        await insert_income(
            session, space_id, user_id, account.id, category.id, MAX_ENTRY, day=date(2026, 10, day)
        )

    change = await _change(session, space_id, account_id=str(account.id), month="2026-10")

    assert change == 2 * MAX_ENTRY


async def test_without_an_account_the_service_gives_none_and_with_a_foreign_one_zero(
    session: AsyncSession,
) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    _, space_b = await make_user_and_space(session, "uid-b")
    account = await make_account(session, space_a)
    category = await make_category(session, space_a)
    await insert_expense(session, space_a, user_a, account.id, category.id, 100)

    assert await _change(session, space_a, month="2026-10") is None
    assert await _change(session, space_a, account_id=str(account.id), month="2026-10") == -100
    # The account exists, but in another space: the space of the request decides.
    assert await _change(session, space_b, account_id=str(account.id), month="2026-10") == 0
    assert await _change(session, space_b, account_id=str(uuid.uuid4())) == 0

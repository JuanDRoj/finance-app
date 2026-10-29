"""Helpers to build movements in the tests of `transactions` and of the balances they feed.

`insert_transaction` writes rows through the ORM with any `status` and `deleted_at`: pending,
skipped and deleted movements have no creation path in the API yet, and the balance has to ignore
them. The happy path of the real write goes through `transactions.service.create_transaction`.
"""

import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.accounts import service as accounts_service
from app.modules.accounts.models import Account
from app.modules.accounts.schemas import AccountCreate
from app.modules.categories import service as categories_service
from app.modules.categories.models import Category
from app.modules.categories.schemas import CategoryCreate
from app.modules.spaces import service as spaces_service
from app.modules.transactions.models import Entry, Transaction
from app.modules.users import service as users_service

# (account id, signed amount in the minor unit, category id or None)
EntrySpec = tuple[uuid.UUID, int, uuid.UUID | None]


async def make_user_and_space(session: AsyncSession, uid: str) -> tuple[uuid.UUID, uuid.UUID]:
    """A user with their personal space; returns `(user_id, space_id)`."""
    user = await users_service.upsert_user(
        session, firebase_uid=uid, email=f"{uid}@example.com", display_name=None
    )
    await spaces_service.ensure_personal_space(session, user.id, "America/Montevideo")
    return user.id, await spaces_service.get_personal_space_id(session, user.id)


async def make_account(
    session: AsyncSession,
    space_id: uuid.UUID,
    *,
    type_: str = "bank",
    name: str = "Itaú",
    archived: bool = False,
) -> Account:
    days = {"closing_day": 5, "due_day": 12} if type_ == "credit_card" else {}
    account = await accounts_service.create_account(
        session, space_id, AccountCreate.model_validate({"type": type_, "name": name, **days})
    )
    if archived:
        # Written directly on purpose: it skips the zero-balance rule of `archive_account`, so a
        # test can have an archived account that still has a balance.
        account.archived_at = datetime.now(UTC)
        await session.flush()
    return account


async def make_category(
    session: AsyncSession,
    space_id: uuid.UUID,
    *,
    kind: str = "expense",
    name: str = "Comida",
    parent_id: uuid.UUID | None = None,
    archived: bool = False,
) -> Category:
    category = await categories_service.create_category(
        session,
        space_id,
        CategoryCreate.model_validate(
            {"name": name, "kind": kind, "icon": "fork-knife", "parent_id": parent_id}
        ),
    )
    if archived:
        await categories_service.archive_category(session, space_id, category.id)
    return category


async def insert_transaction(
    session: AsyncSession,
    space_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    entries: Sequence[EntrySpec],
    type_: str = "adjustment",
    status: str = "confirmed",
    deleted_at: datetime | None = None,
    day: date = date(2026, 10, 20),
    description: str | None = None,
) -> Transaction:
    """A transaction with its entries, written as is (no validation, no locks)."""
    transaction = Transaction(
        space_id=space_id,
        type=type_,
        status=status,
        date=day,
        description=description,
        created_by=user_id,
        deleted_at=deleted_at,
    )
    session.add(transaction)
    await session.flush()
    session.add_all(
        Entry(
            transaction_id=transaction.id,
            space_id=space_id,
            account_id=account_id,
            amount_minor=amount,
            category_id=category_id,
        )
        for account_id, amount, category_id in entries
    )
    await session.flush()
    return transaction


# Shortcuts over `insert_transaction` for the usual shapes. `fields` are its keyword arguments
# (`status`, `deleted_at`, `day`, `description`). Amounts are positive, except the adjustment's.


async def insert_expense(
    session: AsyncSession,
    space_id: uuid.UUID,
    user_id: uuid.UUID,
    account_id: uuid.UUID,
    category_id: uuid.UUID,
    amount: int,
    **fields: Any,
) -> Transaction:
    return await insert_transaction(
        session,
        space_id,
        user_id,
        entries=[(account_id, -amount, category_id)],
        type_="expense",
        **fields,
    )


async def insert_income(
    session: AsyncSession,
    space_id: uuid.UUID,
    user_id: uuid.UUID,
    account_id: uuid.UUID,
    category_id: uuid.UUID,
    amount: int,
    **fields: Any,
) -> Transaction:
    return await insert_transaction(
        session,
        space_id,
        user_id,
        entries=[(account_id, amount, category_id)],
        type_="income",
        **fields,
    )


async def insert_transfer(
    session: AsyncSession,
    space_id: uuid.UUID,
    user_id: uuid.UUID,
    from_account_id: uuid.UUID,
    to_account_id: uuid.UUID,
    amount: int,
    **fields: Any,
) -> Transaction:
    return await insert_transaction(
        session,
        space_id,
        user_id,
        entries=[(from_account_id, -amount, None), (to_account_id, amount, None)],
        type_="transfer",
        **fields,
    )


async def insert_adjustment(
    session: AsyncSession,
    space_id: uuid.UUID,
    user_id: uuid.UUID,
    account_id: uuid.UUID,
    amount: int,
    **fields: Any,
) -> Transaction:
    return await insert_transaction(
        session,
        space_id,
        user_id,
        entries=[(account_id, amount, None)],
        type_="adjustment",
        **fields,
    )

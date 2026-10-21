import uuid

from sqlalchemy import Select, and_, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.transactions.models import Entry, Transaction


def _counted_entries(space_id: uuid.UUID) -> Select[Entry]:
    """Base query: the entries that count for a balance. Every balance query starts here.

    A movement counts only if it is `confirmed` and not deleted: pending and skipped ones (the
    cron of the recurring templates creates them) and the soft-deleted ones never reach a balance.
    The filter lives only here, so no caller can forget it. It also stays in the space: the entry
    and its transaction must share `space_id` (the database enforces it with the composite foreign
    key, and the join repeats it).
    """
    return (
        select(Entry)
        .join(
            Transaction,
            and_(Transaction.id == Entry.transaction_id, Transaction.space_id == Entry.space_id),
        )
        .where(
            Entry.space_id == space_id,
            Transaction.status == "confirmed",
            Transaction.deleted_at.is_(None),
        )
    )


async def balances_by_account(
    session: AsyncSession, *, space_id: uuid.UUID
) -> dict[uuid.UUID, int]:
    """The balance of every account of the space that has counted entries (the others have 0)."""
    stmt = (
        _counted_entries(space_id)
        .with_only_columns(
            Entry.account_id, func.sum(Entry.amount_minor), maintain_column_froms=True
        )
        .group_by(Entry.account_id)
    )
    # SUM(bigint) is numeric in PostgreSQL: asyncpg returns a Decimal. Money here is always `int`.
    return {account_id: int(total) for account_id, total in await session.execute(stmt)}


async def balance_of_account(
    session: AsyncSession, *, space_id: uuid.UUID, account_id: uuid.UUID
) -> int:
    """The balance of one account (0 if it has no counted entries or is not in the space)."""
    stmt = (
        _counted_entries(space_id)
        .with_only_columns(
            func.coalesce(func.sum(Entry.amount_minor), 0), maintain_column_froms=True
        )
        .where(Entry.account_id == account_id)
    )
    return int(await session.scalar(stmt) or 0)


async def space_has_transactions(session: AsyncSession, *, space_id: uuid.UUID) -> bool:
    """True if the space has any transaction at all: whatever its status, deleted ones included.

    The opposite of `_counted_entries` on purpose. A balance ignores pending, skipped and deleted
    movements, but this answers "was money ever written in this space?": a deleted movement keeps
    its amount in the minor unit of the currency it was written in, and that is what stops the
    currency from changing. It filters only by the space (the index `ix_transactions_space_id` is
    complete, the listing one skips the deleted ones).
    """
    stmt = select(exists().where(Transaction.space_id == space_id))
    return bool(await session.scalar(stmt))

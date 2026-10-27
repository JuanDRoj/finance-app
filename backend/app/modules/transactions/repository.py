import uuid
from datetime import datetime

from sqlalchemy import Select, and_, exists, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.modules.transactions.models import Entry, IdempotencyKey, Transaction


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


async def get_with_entries(
    session: AsyncSession, *, space_id: uuid.UUID, transaction_id: uuid.UUID
) -> Transaction | None:
    """One transaction of the space with its entries loaded, whatever its status or `deleted_at`.

    Unlike `_counted_entries` it does not hide pending, skipped or deleted ones: it answers "what
    is this movement now?" for a replay of an `Idempotency-Key`, not "what counts for a balance".
    `populate_existing` makes the answer come from the database even if the session already holds
    the object.
    """
    stmt = (
        select(Transaction)
        .where(Transaction.space_id == space_id, Transaction.id == transaction_id)
        .options(selectinload(Transaction.entries))
        .execution_options(populate_existing=True)
    )
    return await session.scalar(stmt)


async def claim_idempotency_key(
    session: AsyncSession,
    *,
    space_id: uuid.UUID,
    user_id: uuid.UUID,
    key: uuid.UUID,
    request_hash: bytes,
    now: datetime,
    expired_before: datetime,
) -> bool:
    """Take the key for this request: True if it is ours, False if a live one already exists.

    One atomic statement: `INSERT ... ON CONFLICT DO UPDATE ... WHERE created_at <= expired_before`.
    A new key is inserted; an expired one is replaced (new hash, no movement yet, `created_at` =
    `now`); a live one keeps its data and nothing is returned. If another transaction has the key
    claimed and has not finished, this waits for it (holding no lock while it waits): when it
    commits the conflict is real and the answer is False, and when it rolls back the insert goes on
    and the key is ours. So two requests with the same key meet here, before either of them touches
    an account. The row is written without a movement (`transaction_id` NULL);
    `attach_idempotency_key` ties them.

    Against a live key nothing is written, but the row does not stay free: PostgreSQL locks the
    conflicting row (`FOR NO KEY UPDATE`) before it evaluates the `WHERE`, even when it is false,
    and keeps the lock until the transaction ends. Harmless, because the replay or the 409 that
    follows only reads, so it never takes another lock; the only effect is that two replays of the
    same key in flight run one after the other (see
    `tests/db/test_transaction_idempotency_concurrency.py`).
    """
    new_row = insert(IdempotencyKey).values(
        space_id=space_id, user_id=user_id, key=key, request_hash=request_hash, created_at=now
    )
    stmt = new_row.on_conflict_do_update(
        index_elements=[IdempotencyKey.space_id, IdempotencyKey.user_id, IdempotencyKey.key],
        set_={
            "request_hash": new_row.excluded.request_hash,
            "transaction_id": None,
            "created_at": new_row.excluded.created_at,
        },
        where=IdempotencyKey.created_at <= expired_before,
    ).returning(IdempotencyKey.key)
    return (await session.execute(stmt)).first() is not None


async def get_idempotency_key(
    session: AsyncSession, *, space_id: uuid.UUID, user_id: uuid.UUID, key: uuid.UUID
) -> IdempotencyKey | None:
    """The row of a key, read from the database (not from what the session may remember)."""
    stmt = (
        select(IdempotencyKey)
        .where(
            IdempotencyKey.space_id == space_id,
            IdempotencyKey.user_id == user_id,
            IdempotencyKey.key == key,
        )
        .execution_options(populate_existing=True)
    )
    return await session.scalar(stmt)


async def attach_idempotency_key(
    session: AsyncSession,
    *,
    space_id: uuid.UUID,
    user_id: uuid.UUID,
    key: uuid.UUID,
    transaction_id: uuid.UUID,
) -> None:
    """Tie a claimed key to the movement it created (the same transaction, so both or neither)."""
    stmt = (
        update(IdempotencyKey)
        .where(
            IdempotencyKey.space_id == space_id,
            IdempotencyKey.user_id == user_id,
            IdempotencyKey.key == key,
        )
        .values(transaction_id=transaction_id)
    )
    await session.execute(stmt)

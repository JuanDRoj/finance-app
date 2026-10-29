import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import ColumnElement, Select, and_, exists, func, select, tuple_, update
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


def _active(space_id: uuid.UUID) -> Select[Transaction]:
    """Base query of the movements list: the space and not deleted, in any status.

    Unlike `_counted_entries` it keeps pending and skipped movements (the list shows them with
    their status). What counts for a balance or a total is decided by the queries that need it.
    """
    return select(Transaction).where(
        Transaction.space_id == space_id, Transaction.deleted_at.is_(None)
    )


@dataclass(frozen=True, slots=True)
class ListCriteria:
    """The filters of the list, ready for the database (the service resolves them).

    `category_ids` already holds the category and its subcategories; `None` means no category
    filter and an empty sequence matches nothing. `month` is `(first day, first day of the next
    month)`. `search` is the text as the user typed it: the pattern is built here.
    """

    month: tuple[date, date] | None = None
    type: str | None = None
    account_id: uuid.UUID | None = None
    category_ids: Sequence[uuid.UUID] | None = None
    search: str | None = None


def _transaction_predicates(criteria: ListCriteria) -> list[ColumnElement[bool]]:
    """The filters that look only at the transaction (not at its entries)."""
    predicates: list[ColumnElement[bool]] = []
    if criteria.month is not None:
        first, following = criteria.month
        predicates += [Transaction.date >= first, Transaction.date < following]
    if criteria.type is not None:
        predicates.append(Transaction.type == criteria.type)
    if criteria.search is not None:
        # `unaccent` (extension, migration 0008) on the column and on the pattern; ILIKE for the
        # case. The wildcards of the user's text are escaped so that `%` and `_` are plain text.
        pattern = "%" + _escape_like(criteria.search) + "%"
        predicates.append(
            func.unaccent(Transaction.description).ilike(func.unaccent(pattern), escape="\\")
        )
    return predicates


def _entry_predicates(criteria: ListCriteria) -> list[ColumnElement[bool]]:
    """The filters that look at the entries: the account and the category."""
    predicates: list[ColumnElement[bool]] = []
    if criteria.account_id is not None:
        predicates.append(Entry.account_id == criteria.account_id)
    if criteria.category_ids is not None:
        predicates.append(Entry.category_id.in_(list(criteria.category_ids)))
    return predicates


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _filtered(space_id: uuid.UUID, criteria: ListCriteria) -> Select[Transaction]:
    """`_active` narrowed by every filter: the rows the list shows, whatever their order."""
    stmt = _active(space_id).where(*_transaction_predicates(criteria))
    entry_predicates = _entry_predicates(criteria)
    if entry_predicates:
        stmt = stmt.where(
            exists().where(
                Entry.transaction_id == Transaction.id,
                Entry.space_id == Transaction.space_id,
                *entry_predicates,
            )
        )
    return stmt


async def list_page(
    session: AsyncSession,
    *,
    space_id: uuid.UUID,
    criteria: ListCriteria,
    after: tuple[date, uuid.UUID] | None,
    limit: int,
) -> list[Transaction]:
    """Up to `limit` movements, newest first (`date desc, id desc`), with their entries loaded.

    `after` is the `(date, id)` of the last item of the previous page: the rows that come after it
    in that order. The pair is unique, so pages never repeat or skip a row even when many share a
    date. The partial index `ix_transactions_space_id_date_id_active` serves the order and the
    comparison. The caller asks for one more than it shows to know if there is a next page.
    """
    stmt = _filtered(space_id, criteria)
    if after is not None:
        stmt = stmt.where(tuple_(Transaction.date, Transaction.id) < tuple_(*after))
    stmt = (
        stmt.order_by(Transaction.date.desc(), Transaction.id.desc())
        .limit(limit)
        .options(selectinload(Transaction.entries))
        .execution_options(populate_existing=True)
    )
    return list(await session.scalars(stmt))


async def count(session: AsyncSession, *, space_id: uuid.UUID, criteria: ListCriteria) -> int:
    """How many movements the list would show for these filters, in any page."""
    filtered = _filtered(space_id, criteria).with_only_columns(Transaction.id).subquery()
    return int(await session.scalar(select(func.count()).select_from(filtered)) or 0)


async def income_and_expense(
    session: AsyncSession, *, space_id: uuid.UUID, criteria: ListCriteria
) -> tuple[int, int]:
    """`(income, expense)` of the filtered period, both as positive amounts.

    Only confirmed incomes and expenses: adjustments, transfers, pending, skipped and deleted
    movements add nothing. It sums entries, so the account and category filters narrow what is
    added (today a movement has one entry, so it is the same as narrowing the movement). The
    expense entries are negative: the sign is flipped here.
    """
    stmt = (
        select(Transaction.type, func.sum(Entry.amount_minor))
        .select_from(Transaction)
        .join(
            Entry,
            and_(Entry.transaction_id == Transaction.id, Entry.space_id == Transaction.space_id),
        )
        .where(
            Transaction.space_id == space_id,
            Transaction.deleted_at.is_(None),
            Transaction.status == "confirmed",
            Transaction.type.in_(("income", "expense")),
            *_transaction_predicates(criteria),
            *_entry_predicates(criteria),
        )
        .group_by(Transaction.type)
    )
    # SUM(bigint) is numeric: asyncpg returns a Decimal and money here is always `int`.
    totals = {kind: int(total) for kind, total in await session.execute(stmt)}
    return totals.get("income", 0), -totals.get("expense", 0)


async def balances_after(
    session: AsyncSession,
    *,
    space_id: uuid.UUID,
    account_id: uuid.UUID,
    transaction_ids: Sequence[uuid.UUID],
) -> dict[uuid.UUID, int]:
    """The balance of the account right after each of these transactions.

    The running sum, in the order `(date, id)`, of everything that counts for the balance of the
    account (`_counted_entries`: confirmed and not deleted), over its whole history: the filters of
    the list do not apply, because a movement that a filter hides still moved the balance. A
    transaction that does not count (pending, skipped) is not in the answer. One pass over the
    entries of the account; the window cannot be filtered in the same query (WHERE runs before
    window functions), so the page's ids are filtered in an outer query. A transaction is summed
    first (it could have more than one entry in the account) so each one has a single balance.
    """
    if not transaction_ids:
        return {}
    per_transaction = (
        _counted_entries(space_id)
        .where(Entry.account_id == account_id)
        .with_only_columns(
            Transaction.id.label("id"),
            Transaction.date.label("date"),
            func.sum(Entry.amount_minor).label("delta"),
            maintain_column_froms=True,
        )
        .group_by(Transaction.id, Transaction.date)
        .subquery()
    )
    running = (
        select(
            per_transaction.c.id,
            func.sum(per_transaction.c.delta)
            .over(order_by=(per_transaction.c.date, per_transaction.c.id), rows=(None, 0))
            .label("balance"),
        )
    ).subquery()
    stmt = select(running.c.id, running.c.balance).where(running.c.id.in_(list(transaction_ids)))
    return {transaction_id: int(balance) for transaction_id, balance in await session.execute(stmt)}


async def get_active_with_entries(
    session: AsyncSession, *, space_id: uuid.UUID, transaction_id: uuid.UUID
) -> Transaction | None:
    """One movement of the space with its entries, in any status; None if it is deleted.

    Unlike `get_with_entries` (the replay of an `Idempotency-Key`) it hides the deleted ones: this
    is what the detail shows.
    """
    stmt = (
        _active(space_id)
        .where(Transaction.id == transaction_id)
        .options(selectinload(Transaction.entries))
        .execution_options(populate_existing=True)
    )
    return await session.scalar(stmt)


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

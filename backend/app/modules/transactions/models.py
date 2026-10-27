import datetime as dt
import uuid

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    LargeBinary,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Transaction(Base):
    """What happened: an expense, an income, a transfer or an adjustment. Soft-deleted, never gone.

    The money is in its entries (`Entry`): the amounts live there, with the sign, never here. Only
    a `confirmed` transaction that is not deleted counts for a balance (see `repository`).
    `date` is the local date of the user (the space's timezone), not a moment. The currency is the
    one of the space. Foreign keys to other modules go by table name.

    `UNIQUE (id, space_id)` is the target of the composite foreign keys of `entries`: it is what
    lets the database itself guarantee that an entry and its transaction are in the same space.
    """

    __tablename__ = "transactions"
    __table_args__ = (
        CheckConstraint("type IN ('expense', 'income', 'transfer', 'adjustment')", name="type"),
        CheckConstraint("status IN ('pending', 'confirmed', 'skipped')", name="status"),
        # The description is optional: NULL passes both checks.
        CheckConstraint("btrim(description) <> ''", name="description_not_blank"),
        CheckConstraint("char_length(description) <= 200", name="description_length"),
        UniqueConstraint("id", "space_id"),
        # The listing of the space, newest first, without the deleted ones (cursor pagination).
        Index(
            "ix_transactions_space_id_date_id_active",
            "space_id",
            text("date DESC"),
            text("id DESC"),
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid7)
    # RESTRICT: money data must never disappear through a cascade from its space. The complete
    # index (the listing one is partial) answers "does the space have any transaction, deleted ones
    # included?", which locks the currency of the space.
    space_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("spaces.id", ondelete="RESTRICT"), index=True
    )
    type: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text)
    date: Mapped[dt.date] = mapped_column(Date)
    description: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))

    # Never lazy: load it with `selectinload`. Assigning it on a new transaction is fine.
    entries: Mapped[list[Entry]] = relationship(
        lazy="raise", order_by="Entry.id", cascade="all, delete-orphan", passive_deletes=True
    )


class Entry(Base):
    """How a transaction affects one account: a signed amount in the minor unit of the currency.

    A transfer has two entries that add up to zero. `space_id` repeats the space of the
    transaction on purpose: the three foreign keys are composite `(x_id, space_id)`, so the
    transaction, the account and the category of an entry must all be in the same space or the
    database refuses the row. A NULL `category_id` skips its foreign key (MATCH SIMPLE).

    Whether a category is required (expense, income) or absent (transfer, adjustment) depends on
    the type of the transaction, which the entry does not know: `build_entries` guarantees it.
    """

    __tablename__ = "entries"
    __table_args__ = (
        CheckConstraint("amount_minor <> 0", name="amount_not_zero"),
        # The same cap as the API (`Amount`, `SignedAmount`): JavaScript's Number.MAX_SAFE_INTEGER.
        CheckConstraint(
            "amount_minor BETWEEN -9007199254740991 AND 9007199254740991", name="amount_range"
        ),
        # The entries die with their transaction (a hard delete never happens in the app).
        ForeignKeyConstraint(
            ["transaction_id", "space_id"],
            ["transactions.id", "transactions.space_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["account_id", "space_id"], ["accounts.id", "accounts.space_id"], ondelete="RESTRICT"
        ),
        ForeignKeyConstraint(
            ["category_id", "space_id"],
            ["categories.id", "categories.space_id"],
            ondelete="RESTRICT",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid7)
    transaction_id: Mapped[uuid.UUID] = mapped_column(index=True)
    space_id: Mapped[uuid.UUID] = mapped_column()
    account_id: Mapped[uuid.UUID] = mapped_column(index=True)
    amount_minor: Mapped[int] = mapped_column(BigInteger)
    # Indexed like the other two: deleting a category checks its entries by this key (RESTRICT),
    # and the reports by category (budgets, dashboard) filter by it.
    category_id: Mapped[uuid.UUID | None] = mapped_column(index=True)


class IdempotencyKey(Base):
    """An `Idempotency-Key` already seen by `POST /spaces/{id}/transactions`, with what it created.

    The primary key is `(space_id, user_id, key)`: the same key of another user or of another space
    is another row. `request_hash` is the sha256 of the validated body
    (`idempotency.request_fingerprint`), so the same key with another body is detected.
    `transaction_id` is NULL only inside the request that claimed the key, between the claim and
    the creation of the movement: that row is not committed, so nobody else reads it, and every
    committed row has its movement. The rows are written with `INSERT ... ON CONFLICT`
    (`repository.claim_idempotency_key`), never through the ORM unit of work. A key counts for
    `IDEMPOTENCY_KEY_TTL`; an expired one is replaced when its key is claimed again, and nothing
    deletes them yet.

    The user must be a member of the space (composite foreign key to `space_members`) and the
    movement must be in the same space (composite foreign key to `transactions`, like the entries).
    Both cascade: a key means nothing without its member or its movement.
    """

    __tablename__ = "idempotency_keys"
    __table_args__ = (
        CheckConstraint("octet_length(request_hash) = 32", name="request_hash_length"),
        ForeignKeyConstraint(
            ["user_id", "space_id"],
            ["space_members.user_id", "space_members.space_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["transaction_id", "space_id"],
            ["transactions.id", "transactions.space_id"],
            ondelete="CASCADE",
        ),
    )

    space_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    key: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    request_hash: Mapped[bytes] = mapped_column(LargeBinary)
    transaction_id: Mapped[uuid.UUID | None] = mapped_column()
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

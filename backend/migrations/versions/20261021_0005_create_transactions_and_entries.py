"""create transactions and entries

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-21

`transactions` (what happened) and `entries` (how it affects each account). The balance is not
stored: it is the sum of the entries of a `confirmed`, not deleted transaction.

- `transactions.type` and `status` are text plus a named CHECK. `date` is the local date of the
  user. `description` is optional (NULL) and, when present, trimmed-not-empty and at most 200
  characters. `created_by` is required. The columns of the recurring templates (`template_id`,
  `period`, `installment_number`) and `linked_transaction_id` are NOT created: they arrive with the
  modules that use them. The partial index serves the listing of a space, newest first, without
  the deleted ones.
- `entries` repeats `space_id` on purpose and references its transaction, its account and its
  category with composite foreign keys `(x_id, space_id)`. The database itself therefore refuses an
  entry whose account or category is in another space than its transaction. For that, `accounts`,
  `categories` and `transactions` get `UNIQUE (id, space_id)` (the target of those keys). A NULL
  `category_id` skips its key (MATCH SIMPLE). The amount cannot be 0 and is capped to JavaScript's
  safe integers, like the API. The three keys of an entry are indexed (`transaction_id`,
  `account_id`, `category_id`): the restricting foreign keys look its entries up by them.
- Deleting a transaction deletes its entries (CASCADE); an account or a category with entries
  cannot be deleted (RESTRICT), nor a space or a user with transactions.

The two new unique keys must exist before the foreign keys that point at them, and the downgrade
drops them after the tables that depend on them.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | Sequence[str] | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Targets of the composite foreign keys of `entries`: they come first.
    op.create_unique_constraint(op.f("uq_accounts_id_space_id"), "accounts", ["id", "space_id"])
    op.create_unique_constraint(op.f("uq_categories_id_space_id"), "categories", ["id", "space_id"])

    op.create_table(
        "transactions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "type IN ('expense', 'income', 'transfer', 'adjustment')",
            name=op.f("ck_transactions_type"),
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'confirmed', 'skipped')", name=op.f("ck_transactions_status")
        ),
        # The description is optional: NULL passes both checks.
        sa.CheckConstraint(
            "btrim(description) <> ''", name=op.f("ck_transactions_description_not_blank")
        ),
        sa.CheckConstraint(
            "char_length(description) <= 200", name=op.f("ck_transactions_description_length")
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_transactions_created_by_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["space_id"],
            ["spaces.id"],
            name=op.f("fk_transactions_space_id_spaces"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_transactions")),
        sa.UniqueConstraint("id", "space_id", name=op.f("uq_transactions_id_space_id")),
    )
    op.create_index(
        "ix_transactions_space_id_date_id_active",
        "transactions",
        ["space_id", sa.literal_column("date DESC"), sa.literal_column("id DESC")],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "entries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("transaction_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.CheckConstraint("amount_minor <> 0", name=op.f("ck_entries_amount_not_zero")),
        sa.CheckConstraint(
            "amount_minor BETWEEN -9007199254740991 AND 9007199254740991",
            name=op.f("ck_entries_amount_range"),
        ),
        sa.ForeignKeyConstraint(
            ["transaction_id", "space_id"],
            ["transactions.id", "transactions.space_id"],
            name=op.f("fk_entries_transaction_id_space_id_transactions"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["account_id", "space_id"],
            ["accounts.id", "accounts.space_id"],
            name=op.f("fk_entries_account_id_space_id_accounts"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["category_id", "space_id"],
            ["categories.id", "categories.space_id"],
            name=op.f("fk_entries_category_id_space_id_categories"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_entries")),
    )
    op.create_index(op.f("ix_entries_transaction_id"), "entries", ["transaction_id"], unique=False)
    op.create_index(op.f("ix_entries_account_id"), "entries", ["account_id"], unique=False)
    op.create_index(op.f("ix_entries_category_id"), "entries", ["category_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_entries_category_id"), table_name="entries")
    op.drop_index(op.f("ix_entries_account_id"), table_name="entries")
    op.drop_index(op.f("ix_entries_transaction_id"), table_name="entries")
    op.drop_table("entries")
    op.drop_index(
        "ix_transactions_space_id_date_id_active",
        table_name="transactions",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_table("transactions")
    # Only now: the foreign keys of `entries` that pointed at them are gone.
    op.drop_constraint(op.f("uq_categories_id_space_id"), "categories", type_="unique")
    op.drop_constraint(op.f("uq_accounts_id_space_id"), "accounts", type_="unique")

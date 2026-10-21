"""add transactions space id index

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-21

A complete index on `transactions.space_id`. The only index with `space_id` so far is the partial
one of the listing (`WHERE deleted_at IS NULL`), which PostgreSQL cannot use for a query that must
also see the deleted transactions. The currency of a space is fixed once the space has any
transaction, deleted ones included (`transactions.service.space_has_transactions`), and that
question is asked with the space locked: without this index, the common case (a new space with no
transactions) would scan the whole table. It also serves the RESTRICT foreign key when a space is
deleted.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0006"
down_revision: str | Sequence[str] | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(op.f("ix_transactions_space_id"), "transactions", ["space_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_transactions_space_id"), table_name="transactions")

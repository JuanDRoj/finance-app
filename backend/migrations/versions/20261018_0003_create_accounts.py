"""create accounts

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-18

`accounts` (bank, cash or credit card of a space). The balance is not stored: it is computed from
the entries of the account. `type` is text plus a named CHECK. `closing_day` and `due_day` exist
only on credit cards, and both are required there (`ck_accounts_card_days`). The foreign key to
`spaces` is RESTRICT: money data must not disappear through a cascade.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("closing_day", sa.SmallInteger(), nullable=True),
        sa.Column("due_day", sa.SmallInteger(), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "type IN ('bank', 'cash', 'credit_card')", name=op.f("ck_accounts_type")
        ),
        sa.CheckConstraint("btrim(name) <> ''", name=op.f("ck_accounts_name_not_blank")),
        sa.CheckConstraint("char_length(name) <= 80", name=op.f("ck_accounts_name_length")),
        sa.CheckConstraint(
            "closing_day BETWEEN 1 AND 31", name=op.f("ck_accounts_closing_day_range")
        ),
        sa.CheckConstraint("due_day BETWEEN 1 AND 31", name=op.f("ck_accounts_due_day_range")),
        sa.CheckConstraint(
            "(type = 'credit_card' AND closing_day IS NOT NULL AND due_day IS NOT NULL) "
            "OR (type <> 'credit_card' AND closing_day IS NULL AND due_day IS NULL)",
            name=op.f("ck_accounts_card_days"),
        ),
        sa.ForeignKeyConstraint(
            ["space_id"],
            ["spaces.id"],
            name=op.f("fk_accounts_space_id_spaces"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_accounts")),
    )
    op.create_index(op.f("ix_accounts_space_id"), "accounts", ["space_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_accounts_space_id"), table_name="accounts")
    op.drop_table("accounts")

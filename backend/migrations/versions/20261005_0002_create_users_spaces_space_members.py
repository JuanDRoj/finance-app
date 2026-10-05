"""create users, spaces, space_members

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-05

`users` (linked to Firebase by `firebase_uid`), `spaces` (owner of all data; at most one
personal space per creator, enforced by a partial unique index) and `space_members`.
Enum-like values (`type`, `role`) are text plus a named CHECK.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("firebase_uid", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("firebase_uid", name=op.f("uq_users_firebase_uid")),
    )
    op.create_table(
        "spaces",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("currency", sa.CHAR(length=3), nullable=False),
        sa.Column("timezone", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("type IN ('personal', 'household')", name=op.f("ck_spaces_type")),
        sa.ForeignKeyConstraint(
            ["currency"],
            ["currencies.code"],
            name=op.f("fk_spaces_currency_currencies"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_spaces_created_by_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_spaces")),
    )
    op.create_index(
        "uq_spaces_created_by_personal",
        "spaces",
        ["created_by"],
        unique=True,
        postgresql_where=sa.text("type = 'personal'"),
    )
    op.create_table(
        "space_members",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("role IN ('owner', 'member')", name=op.f("ck_space_members_role")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_space_members_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["space_id"],
            ["spaces.id"],
            name=op.f("fk_space_members_space_id_spaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "space_id", name=op.f("pk_space_members")),
    )
    op.create_index(op.f("ix_space_members_space_id"), "space_members", ["space_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_space_members_space_id"), table_name="space_members")
    op.drop_table("space_members")
    op.drop_index("uq_spaces_created_by_personal", table_name="spaces")
    op.drop_table("spaces")
    op.drop_table("users")

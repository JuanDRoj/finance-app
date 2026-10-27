"""create idempotency keys

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-27

`idempotency_keys`: the `Idempotency-Key` headers already seen by `POST /spaces/{id}/transactions`,
so that repeating a request (a double tap, a retry after a lost response) creates one movement.

- The primary key is `(space_id, user_id, key)`: it is the UNIQUE the claim relies on
  (`INSERT ... ON CONFLICT`), and the same key of another user or of another space is another row.
  Nothing else is indexed: the primary key serves every lookup. A purge by `created_at` will bring
  its own index with the job that runs it.
- `request_hash` is the sha256 of the validated body (32 bytes, checked), to tell a retry from the
  same key used with another body.
- `transaction_id` is NULL only inside the request that claimed the key, between the claim and the
  creation of the movement. That row is not committed, so nobody else reads it: every committed row
  has its movement. (A deferred foreign key with the id generated beforehand would make it NOT NULL,
  but it would not be checked by the tests that roll back instead of committing.)
- The user must be a member of the space: one composite foreign key to `space_members`
  `(user_id, space_id)` (its primary key), `ON DELETE CASCADE`. The movement must be in the same
  space: a composite foreign key to `transactions` `(id, space_id)`, like the entries, `ON DELETE
  CASCADE` (the app never hard-deletes, so it never fires). With `transaction_id` NULL the second
  key is skipped (MATCH SIMPLE) and only the membership is checked.
- Expired keys are replaced when the same key is claimed again; there is no purge yet.

The downgrade drops the table; no other table is touched.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | Sequence[str] | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "idempotency_keys",
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.Uuid(), nullable=False),
        sa.Column("request_hash", sa.LargeBinary(), nullable=False),
        sa.Column("transaction_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "octet_length(request_hash) = 32", name=op.f("ck_idempotency_keys_request_hash_length")
        ),
        sa.ForeignKeyConstraint(
            ["transaction_id", "space_id"],
            ["transactions.id", "transactions.space_id"],
            name=op.f("fk_idempotency_keys_transaction_id_space_id_transactions"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id", "space_id"],
            ["space_members.user_id", "space_members.space_id"],
            name=op.f("fk_idempotency_keys_user_id_space_id_space_members"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("space_id", "user_id", "key", name=op.f("pk_idempotency_keys")),
    )


def downgrade() -> None:
    op.drop_table("idempotency_keys")

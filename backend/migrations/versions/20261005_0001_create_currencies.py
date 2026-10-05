"""create currencies

Revision ID: 0001
Revises:
Create Date: 2026-10-05

Supported currencies and their ISO 4217 exponent (minor unit = 10^-exponent). Adding a
currency is inserting a row (a data migration), not a code change.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# ISO 4217 "List One", column "Minor unit".
SEED = [
    ("UYU", 2),
    ("COP", 2),
    ("USD", 2),
    ("ARS", 2),
    ("BRL", 2),
    ("EUR", 2),
    ("CLP", 0),
    ("PYG", 0),
]


def upgrade() -> None:
    currencies = op.create_table(
        "currencies",
        sa.Column("code", sa.CHAR(length=3), nullable=False),
        sa.Column("exponent", sa.SmallInteger(), nullable=False),
        sa.CheckConstraint("code ~ '^[A-Z]{3}$'", name=op.f("ck_currencies_code_format")),
        sa.CheckConstraint("exponent BETWEEN 0 AND 4", name=op.f("ck_currencies_exponent_range")),
        sa.PrimaryKeyConstraint("code", name=op.f("pk_currencies")),
    )
    op.bulk_insert(currencies, [{"code": c, "exponent": e} for c, e in SEED])


def downgrade() -> None:
    op.drop_table("currencies")

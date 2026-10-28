"""enable unaccent

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-28

The search of the movements list (`GET /spaces/{id}/transactions?q=`) ignores case and accents:
"cafe" finds "Café". PostgreSQL does it with `unaccent(description) ILIKE unaccent(pattern)`, and
`unaccent` is a contrib extension that has to be created in each database. It is a trusted
extension (PostgreSQL 13+), so the owner of the database can create it; Cloud SQL ships it.

The extension lives in the schema it is created in (`public`, the default search path). Its
function is STABLE, not IMMUTABLE, so it cannot be used in an index expression as it is: the search
has no index of its own (it is bounded by the space and, normally, by the month). `IF [NOT] EXISTS`
makes both directions safe to repeat, and the downgrade only drops it because nothing else in the
schema depends on it.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0008"
down_revision: str | Sequence[str] | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")


def downgrade() -> None:
    op.execute("DROP EXTENSION IF EXISTS unaccent")

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Select, exists, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.categories.models import Category


def _in_space(space_id: uuid.UUID) -> Select[Category]:
    """Base query: every query of this module starts here, so none can leave the space."""
    return select(Category).where(Category.space_id == space_id)


async def get(
    session: AsyncSession, *, space_id: uuid.UUID, category_id: uuid.UUID
) -> Category | None:
    """The category, active or archived; None if it does not exist or is in another space."""
    return await session.scalar(_in_space(space_id).where(Category.id == category_id))


async def list_for_space(
    session: AsyncSession, *, space_id: uuid.UUID, include_archived: bool
) -> list[Category]:
    """The categories of the space in creation order; the archived ones only if asked for.

    `created_at` is the transaction start, so rows made together (the predefined ones) tie and
    the UUIDv7 `id`, which grows in the order it was generated, keeps the order they were made in.
    """
    stmt = _in_space(space_id).order_by(Category.created_at, Category.id)
    if not include_archived:
        stmt = stmt.where(Category.archived_at.is_(None))
    return list(await session.scalars(stmt))


async def has_any(session: AsyncSession, *, space_id: uuid.UUID) -> bool:
    """Whether the space has at least one category, archived or not."""
    return bool(await session.scalar(select(exists().where(Category.space_id == space_id))))


async def insert_ignoring_duplicates(session: AsyncSession, rows: list[dict[str, Any]]) -> int:
    """Insert the rows, skipping the ones that clash with an existing name; how many went in.

    `ON CONFLICT DO NOTHING` without a target covers both name indexes. A concurrent insert of the
    same names makes this wait until that transaction ends, and then skip them.
    """
    stmt = insert(Category).values(rows).on_conflict_do_nothing().returning(Category.id)
    return len((await session.execute(stmt)).all())


async def main_ids_by_kind_and_name(
    session: AsyncSession, *, space_id: uuid.UUID
) -> dict[tuple[str, str], uuid.UUID]:
    """The principal categories of the space keyed by `(kind, lowercase name)`."""
    stmt = _in_space(space_id).where(Category.parent_id.is_(None))
    return {(c.kind, c.name.lower()): c.id for c in await session.scalars(stmt)}


async def archive_active_subcategories(
    session: AsyncSession, *, space_id: uuid.UUID, parent_id: uuid.UUID, archived_at: datetime
) -> None:
    """Archive the subcategories of a principal category that are still active."""
    stmt = (
        update(Category)
        .where(
            Category.space_id == space_id,
            Category.parent_id == parent_id,
            Category.archived_at.is_(None),
        )
        .values(archived_at=archived_at)
    )
    await session.execute(stmt)


async def unarchive_subcategories_archived_at(
    session: AsyncSession, *, space_id: uuid.UUID, parent_id: uuid.UUID, archived_at: datetime
) -> None:
    """Restore the subcategories that were archived at exactly `archived_at` (with their main)."""
    stmt = (
        update(Category)
        .where(
            Category.space_id == space_id,
            Category.parent_id == parent_id,
            Category.archived_at == archived_at,
        )
        .values(archived_at=None)
    )
    await session.execute(stmt)

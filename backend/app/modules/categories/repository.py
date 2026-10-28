import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Select, exists, or_, select, update
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


async def get_for_share(
    session: AsyncSession, *, space_id: uuid.UUID, category_id: uuid.UUID
) -> Category | None:
    """Like `get`, but locks the row `FOR SHARE` until the end of the transaction.

    For a writer that checks the state of a category (is the principal still active?) before it
    writes a row that depends on it. `FOR SHARE` conflicts with the UPDATE of that row, which an
    FK check (`FOR KEY SHARE`) does not: if an archive is in flight it waits for it and, in READ
    COMMITTED, then reads the archived row; if the writer goes first, the archive waits for the
    writer to end and its cascade then sees the row the writer committed.

    `populate_existing` makes the read reflect the row as it is now, not as the session saw it.
    """
    stmt = (
        _in_space(space_id)
        .where(Category.id == category_id)
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    )
    return await session.scalar(stmt)


async def get_for_update(
    session: AsyncSession, *, space_id: uuid.UUID, category_id: uuid.UUID
) -> Category | None:
    """Like `get`, but locks the row `FOR NO KEY UPDATE` until the end of the transaction.

    For a writer that reads a category and then updates that same row (archive). Two of them on
    the same category are serialised: the second one waits and, in READ COMMITTED, then reads the
    row the first one committed, so it decides on the current state instead of overwriting it. It
    is also the lock the UPDATE takes anyway, so it blocks nothing more than the UPDATE would:
    `FOR UPDATE` would also stop the foreign key checks of other tables. It conflicts with
    `FOR SHARE` (see `get_for_share`).

    `populate_existing` makes the read reflect the row as it is now, not as the session saw it.
    """
    stmt = (
        _in_space(space_id)
        .where(Category.id == category_id)
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )
    return await session.scalar(stmt)


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


async def ids_with_subcategories(
    session: AsyncSession, *, space_id: uuid.UUID, category_id: uuid.UUID
) -> list[uuid.UUID]:
    """The id of the category and of its subcategories, archived ones included.

    A subcategory has none below it, so it gives only itself. A category that does not exist, or
    is in another space, gives an empty list (the subcategories are looked up inside the space).
    """
    stmt = (
        select(Category.id)
        .where(Category.space_id == space_id)
        .where(or_(Category.id == category_id, Category.parent_id == category_id))
    )
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

import uuid

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.spaces.models import Space, SpaceMember


async def insert_personal_space(
    session: AsyncSession, *, user_id: uuid.UUID, name: str, currency: str, timezone: str
) -> uuid.UUID | None:
    """Insert the user's personal space; None if they already have one.

    `ON CONFLICT ... DO NOTHING` targets the partial unique index `uq_spaces_created_by_personal`
    (not any conflict), so another violation, such as an unknown currency, still raises.
    """
    stmt = (
        insert(Space)
        .values(
            name=name, type="personal", currency=currency, timezone=timezone, created_by=user_id
        )
        .on_conflict_do_nothing(
            index_elements=[Space.created_by], index_where=text("type = 'personal'")
        )
        .returning(Space.id)
    )
    return await session.scalar(stmt)


async def add_member(
    session: AsyncSession, *, space_id: uuid.UUID, user_id: uuid.UUID, role: str
) -> None:
    session.add(SpaceMember(space_id=space_id, user_id=user_id, role=role))
    await session.flush()


async def get_member(
    session: AsyncSession, *, space_id: uuid.UUID, user_id: uuid.UUID
) -> SpaceMember | None:
    """The membership of the user in the space; None if there is none (or no such space)."""
    stmt = select(SpaceMember).where(
        SpaceMember.space_id == space_id, SpaceMember.user_id == user_id
    )
    return await session.scalar(stmt)


async def list_for_user(session: AsyncSession, *, user_id: uuid.UUID) -> list[Space]:
    """The spaces where the user is a member, oldest first."""
    stmt = (
        select(Space)
        .join(SpaceMember, SpaceMember.space_id == Space.id)
        .where(SpaceMember.user_id == user_id)
        .order_by(Space.created_at, Space.id)
    )
    return list(await session.scalars(stmt))


async def get(session: AsyncSession, *, space_id: uuid.UUID) -> Space | None:
    return await session.get(Space, space_id)


async def get_for_update(session: AsyncSession, *, space_id: uuid.UUID) -> Space | None:
    """Like `get`, but locks the row `FOR UPDATE` until the end of the transaction.

    For whoever decides from the **absence** of rows that depend on the space, and then changes
    the space: the currency can only change while the space has no transactions. Every insert into
    `transactions` (and into any other table that points at the space) takes `FOR KEY SHARE` on
    this row through its foreign key, and only `FOR UPDATE` conflicts with it: the `FOR NO KEY
    UPDATE` of the other row locks of the project (`accounts.repository.get_for_update`) would let
    a movement in flight go unseen. So a movement being written makes this wait until it commits
    (and the check that follows sees it), and one that starts later waits for this transaction.
    Two changes at the same time run one after the other. That also stops the foreign key checks
    of new accounts, categories and movements of this space for the few milliseconds of the change.

    `populate_existing` makes the read reflect the row as it is now, not as the session saw it.
    """
    stmt = (
        select(Space)
        .where(Space.id == space_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return await session.scalar(stmt)


async def get_timezone(session: AsyncSession, *, space_id: uuid.UUID) -> str | None:
    """The IANA timezone of the space; None if there is no such space. Reads only that column."""
    return await session.scalar(select(Space.timezone).where(Space.id == space_id))


async def get_personal_space_id(session: AsyncSession, *, user_id: uuid.UUID) -> uuid.UUID | None:
    """The id of the personal space the user created; None if they have none."""
    stmt = select(Space.id).where(Space.created_by == user_id, Space.type == "personal")
    return await session.scalar(stmt)

import uuid

from sqlalchemy import text
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

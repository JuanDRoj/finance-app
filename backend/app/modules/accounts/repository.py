import uuid

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.accounts.models import Account


def _in_space(space_id: uuid.UUID) -> Select[Account]:
    """Base query: every query of this module starts here, so none can leave the space."""
    return select(Account).where(Account.space_id == space_id)


async def get(
    session: AsyncSession, *, space_id: uuid.UUID, account_id: uuid.UUID
) -> Account | None:
    """The account, active or archived; None if it does not exist or is in another space."""
    return await session.scalar(_in_space(space_id).where(Account.id == account_id))


async def list_for_space(
    session: AsyncSession, *, space_id: uuid.UUID, include_archived: bool
) -> list[Account]:
    """The accounts of the space ordered by name; the archived ones only if asked for."""
    stmt = _in_space(space_id).order_by(Account.name, Account.id)
    if not include_archived:
        stmt = stmt.where(Account.archived_at.is_(None))
    return list(await session.scalars(stmt))

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.spaces import repository

# What every user gets on their first login. UYU is seeded in `currencies` (spaces.currency is a
# foreign key to it); the user can change both later.
PERSONAL_SPACE_NAME = "Mi espacio"
PERSONAL_SPACE_CURRENCY = "UYU"


async def ensure_personal_space(session: AsyncSession, user_id: uuid.UUID, timezone: str) -> bool:
    """Give the user their personal space and make them its owner; True if it was created.

    Idempotent: a user who already has one is left untouched (its timezone included), so
    repeated or concurrent first logins end with exactly one space and one membership.
    """
    space_id = await repository.insert_personal_space(
        session,
        user_id=user_id,
        name=PERSONAL_SPACE_NAME,
        currency=PERSONAL_SPACE_CURRENCY,
        timezone=timezone,
    )
    if space_id is None:
        return False
    await repository.add_member(session, space_id=space_id, user_id=user_id, role="owner")
    return True

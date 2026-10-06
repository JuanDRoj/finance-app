import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.modules.currencies import service as currencies_service
from app.modules.currencies.schemas import CurrencyRead
from app.modules.spaces import repository
from app.modules.spaces.models import Space
from app.modules.spaces.schemas import SpaceMemberRead, SpaceRead

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


async def require_member(
    session: AsyncSession, space_id: uuid.UUID, user_id: uuid.UUID
) -> SpaceMemberRead:
    """The user's membership of the space, or `NotFoundError` (404).

    A space that does not exist and one the user does not belong to give the same error, so the
    API never reveals which spaces exist.
    """
    member = await repository.get_member(session, space_id=space_id, user_id=user_id)
    if member is None:
        raise NotFoundError("space_not_found", "Space not found")
    return SpaceMemberRead.model_validate(member)


def _to_read(space: Space, currencies: dict[str, CurrencyRead]) -> SpaceRead:
    # `spaces.currency` is a foreign key to `currencies`, so the lookup cannot miss.
    return SpaceRead(
        id=space.id,
        name=space.name,
        type=space.type,
        currency=currencies[space.currency],
        timezone=space.timezone,
    )


async def _currencies(session: AsyncSession) -> dict[str, CurrencyRead]:
    return {c.code: c for c in await currencies_service.list_currencies(session)}


async def list_spaces(session: AsyncSession, user_id: uuid.UUID) -> list[SpaceRead]:
    """The spaces where the user is a member."""
    spaces = await repository.list_for_user(session, user_id=user_id)
    currencies = await _currencies(session)
    return [_to_read(s, currencies) for s in spaces]


async def get_space(session: AsyncSession, space_id: uuid.UUID) -> SpaceRead:
    """A space with its currency exponent. Membership is checked by the caller (the router)."""
    space = await repository.get(session, space_id=space_id)
    if space is None:
        raise NotFoundError("space_not_found", "Space not found")
    return _to_read(space, await _currencies(session))

import uuid
from collections.abc import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, NotFoundError
from app.modules.currencies import service as currencies_service
from app.modules.currencies.schemas import CurrencyRead
from app.modules.spaces import repository
from app.modules.spaces.models import Space
from app.modules.spaces.schemas import SpaceBase, SpaceMemberRead, SpaceUpdate

# What every user gets on their first login. UYU is seeded in `currencies` (spaces.currency is a
# foreign key to it); the user can change both later.
PERSONAL_SPACE_NAME = "Mi espacio"
PERSONAL_SPACE_CURRENCY = "UYU"

# Stable error code of the currency rule: the frontend translates it.
SPACE_HAS_TRANSACTIONS = "space_has_transactions"


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


async def get_personal_space_id(session: AsyncSession, user_id: uuid.UUID) -> uuid.UUID:
    """The id of the user's personal space, or `NotFoundError` if they have none.

    For the router that composes the first login: it needs the id of the space that
    `ensure_personal_space` just created, to give it its default categories.
    """
    space_id = await repository.get_personal_space_id(session, user_id=user_id)
    if space_id is None:
        raise NotFoundError("space_not_found", "Space not found")
    return space_id


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


def _to_read(space: Space, currencies: dict[str, CurrencyRead]) -> SpaceBase:
    # `spaces.currency` is a foreign key to `currencies`, so the lookup cannot miss.
    return SpaceBase(
        id=space.id,
        name=space.name,
        type=space.type,
        currency=currencies[space.currency],
        timezone=space.timezone,
    )


async def _currencies(session: AsyncSession) -> dict[str, CurrencyRead]:
    return {c.code: c for c in await currencies_service.list_currencies(session)}


async def list_spaces(session: AsyncSession, user_id: uuid.UUID) -> list[SpaceBase]:
    """The spaces where the user is a member."""
    spaces = await repository.list_for_user(session, user_id=user_id)
    currencies = await _currencies(session)
    return [_to_read(s, currencies) for s in spaces]


async def get_space(session: AsyncSession, space_id: uuid.UUID) -> SpaceBase:
    """A space with its currency exponent. Membership is checked by the caller (the router)."""
    space = await repository.get(session, space_id=space_id)
    if space is None:
        raise NotFoundError("space_not_found", "Space not found")
    return _to_read(space, await _currencies(session))


async def update_space(
    session: AsyncSession,
    space_id: uuid.UUID,
    data: SpaceUpdate,
    *,
    has_transactions: Callable[[], Awaitable[bool]],
) -> SpaceBase:
    """Apply only the fields that were sent. Today that is the currency.

    The currency can change only while the space has no transactions (pending, skipped and deleted
    ones included), otherwise `ConflictError` (409 `space_has_transactions`): a stored amount is
    read with the exponent of the currency of its space, so changing it later would reinterpret
    every amount. Asking for the same currency the space already has changes nothing and is never
    refused.

    Whether the space has transactions belongs to `transactions`, a later module, so the router
    brings it as `has_transactions` and this service applies the rule. The order is fixed here so
    no caller can get it wrong: the unsupported currency is refused first (a 422 that needs no
    lock), then the space is read `FOR UPDATE` **first**, and only then is `has_transactions`
    awaited. Every movement takes `FOR KEY SHARE` on its space through its foreign key, which
    conflicts with that lock: a movement in flight makes this wait until it commits and then see
    it (so the change is refused), and a movement that starts later waits for this change and is
    written in the new currency. See `repository.get_for_update`.

    When a new module stores amounts of the space (recurring templates, budgets, goals), the
    router's `has_transactions` must also answer for them, or the change would misread those.
    """
    changes = data.model_dump(exclude_unset=True)
    if "currency" not in changes:
        return await get_space(session, space_id)
    currency = await currencies_service.get_currency(session, changes["currency"])
    space = await repository.get_for_update(session, space_id=space_id)
    if space is None:
        raise NotFoundError("space_not_found", "Space not found")
    if space.currency != currency.code:
        if await has_transactions():
            raise ConflictError(
                SPACE_HAS_TRANSACTIONS,
                "The currency cannot be changed once the space has transactions",
            )
        space.currency = currency.code
        # The UPDATE leaves `updated_at` (its `onupdate`) expired. `SpaceBase` does not expose it;
        # if it ever does, reading it in async raises MissingGreenlet.
        await session.flush()
    return _to_read(space, {currency.code: currency})


async def get_space_timezone(session: AsyncSession, space_id: uuid.UUID) -> str:
    """The IANA timezone of a space (`America/Montevideo`), or `NotFoundError`.

    For whoever only needs to know which local day it is in the space (the date of an adjustment),
    without loading the currencies that `get_space` brings. Membership is checked by the caller.
    """
    timezone = await repository.get_timezone(session, space_id=space_id)
    if timezone is None:
        raise NotFoundError("space_not_found", "Space not found")
    return timezone

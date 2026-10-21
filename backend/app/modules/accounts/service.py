import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import InvalidFieldError, NotFoundError
from app.modules.accounts import repository
from app.modules.accounts.models import Account
from app.modules.accounts.schemas import (
    CARD_DAY_NOT_ALLOWED,
    CARD_DAY_NOT_ALLOWED_MESSAGE,
    AccountCreate,
    AccountRead,
    AccountUpdate,
)

# Callers (the router) are already known to belong to the space: `require_space_member` ran first.
# Every query still filters by `space_id`, so an id from another space is a plain "not found".


async def list_accounts(
    session: AsyncSession, space_id: uuid.UUID, *, include_archived: bool = False
) -> list[AccountRead]:
    """The accounts of the space by name. Archived ones only with `include_archived`.

    Schemas, not ORM objects: the router and other modules (the balance summary) use the list.
    """
    accounts = await repository.list_for_space(
        session, space_id=space_id, include_archived=include_archived
    )
    return [AccountRead.model_validate(a) for a in accounts]


async def create_account(
    session: AsyncSession, space_id: uuid.UUID, data: AccountCreate
) -> Account:
    """Create an account. The schema has already checked the type against the days."""
    account = Account(
        space_id=space_id,
        name=data.name,
        type=data.type,
        closing_day=data.closing_day,
        due_day=data.due_day,
    )
    session.add(account)
    # RETURNING loads the id and the server defaults (`created_at`, `updated_at`); the commit
    # happens when the request ends.
    await session.flush()
    return account


async def update_account(
    session: AsyncSession, space_id: uuid.UUID, account_id: uuid.UUID, data: AccountUpdate
) -> Account:
    """Apply only the fields that were sent. The type cannot change, so neither do the rules."""
    account = await _get_or_raise(session, space_id, account_id)
    changes = data.model_dump(exclude_unset=True)
    if account.type != "credit_card":
        for field in ("closing_day", "due_day"):
            if field in changes:
                raise InvalidFieldError(
                    ("body", field), CARD_DAY_NOT_ALLOWED, CARD_DAY_NOT_ALLOWED_MESSAGE
                )
    if not changes:
        return account
    for field, value in changes.items():
        setattr(account, field, value)
    # The UPDATE leaves `updated_at` (its `onupdate`) expired. `AccountRead` does not expose it; if
    # it ever does, reading it in async raises MissingGreenlet, so use `eager_defaults=True` on
    # the model or `session.refresh(account)` here.
    await session.flush()
    return account


async def get_account(
    session: AsyncSession, space_id: uuid.UUID, account_id: uuid.UUID
) -> AccountRead:
    """For the router and other modules: a schema, never the ORM object."""
    return AccountRead.model_validate(await _get_or_raise(session, space_id, account_id))


async def get_account_for_share(
    session: AsyncSession, space_id: uuid.UUID, account_id: uuid.UUID
) -> AccountRead:
    """Like `get_account`, but locks the account row `FOR SHARE` until the transaction ends.

    For whoever checks an account and then writes something that depends on it being as it was
    read (the entries of a movement: `transactions.service.create_transaction`). Archived ones too.
    Every operation that changes the balance of an account must read it this way, and the archive
    reads it `FOR NO KEY UPDATE` and only then computes the balance. See
    `repository.get_for_share` for why the foreign key is not enough.
    """
    account = await repository.get_for_share(session, space_id=space_id, account_id=account_id)
    if account is None:
        raise NotFoundError("account_not_found", "Account not found")
    return AccountRead.model_validate(account)


async def _get_or_raise(
    session: AsyncSession, space_id: uuid.UUID, account_id: uuid.UUID
) -> Account:
    account = await repository.get(session, space_id=space_id, account_id=account_id)
    if account is None:
        raise NotFoundError("account_not_found", "Account not found")
    return account

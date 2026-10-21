import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, InvalidFieldError, NotFoundError
from app.modules.accounts import repository
from app.modules.accounts.models import Account
from app.modules.accounts.schemas import (
    CARD_DAY_NOT_ALLOWED,
    CARD_DAY_NOT_ALLOWED_MESSAGE,
    AccountCreate,
    AccountRead,
    AccountUpdate,
)

# Stable error code of the archive rule: the frontend translates it.
ACCOUNT_HAS_BALANCE = "account_has_balance"

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


async def archive_account(
    session: AsyncSession,
    space_id: uuid.UUID,
    account_id: uuid.UUID,
    *,
    balance_of: Callable[[], Awaitable[int]],
) -> Account:
    """Archive an account. It needs a zero balance, otherwise `ConflictError` (409).

    The balance belongs to `transactions`, a later module, so the router brings it as `balance_of`
    and this service applies the rule. The order is fixed here so no caller can get it wrong: the
    account is read `FOR NO KEY UPDATE` **first**, and only then is `balance_of` awaited. A writer
    of movements reads its accounts `FOR SHARE`, which conflicts with that lock: a movement in
    flight makes this wait until it commits and then see its balance (so the archive is refused),
    and a movement that starts later waits for this archive and finds the account archived (so it is
    refused). If the balance were read before the lock, a movement confirmed in between would leave
    an archived account with a balance.

    Archiving an archived account changes nothing (and does not ask for the balance). Two archives
    at the same time (a double tap) are serialised by the lock: the second one finds it archived.
    Old movements keep their account; it is only hidden from the lists and from new movements.
    """
    account = await _get_for_update_or_raise(session, space_id, account_id)
    if account.archived_at is not None:
        return account
    if await balance_of() != 0:
        raise ConflictError(
            ACCOUNT_HAS_BALANCE,
            "The account still has a balance; bring it to zero before archiving it",
        )
    account.archived_at = datetime.now(UTC)
    # See `update_account`: the UPDATE leaves `updated_at` expired, and `AccountRead` does not
    # expose it.
    await session.flush()
    return account


async def unarchive_account(
    session: AsyncSession, space_id: uuid.UUID, account_id: uuid.UUID
) -> Account:
    """Make an account active again. There is no balance rule here; an active one changes nothing.

    It reads the account `FOR NO KEY UPDATE` like the archive does, so an archive and an unarchive
    of the same account at the same time end in whichever state came last, never in a mix.
    """
    account = await _get_for_update_or_raise(session, space_id, account_id)
    if account.archived_at is None:
        return account
    account.archived_at = None
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
    Every operation that writes movements must read its accounts this way. Two operations take a
    stronger lock because they read the balance and decide from it: the archive (`archive_account`)
    and the reconciliation (`get_account_for_update`) read the account `FOR NO KEY UPDATE` and only
    then compute the balance. See
    `repository.get_for_share` for why the foreign key is not enough.
    """
    account = await repository.get_for_share(session, space_id=space_id, account_id=account_id)
    if account is None:
        raise NotFoundError("account_not_found", "Account not found")
    return AccountRead.model_validate(account)


async def get_account_for_update(
    session: AsyncSession, space_id: uuid.UUID, account_id: uuid.UUID
) -> AccountRead:
    """Like `get_account_for_share`, but locks the account row `FOR NO KEY UPDATE`.

    For whoever reads an account and the balance **to decide how much to write**, so that nobody
    else can write between the two: the reconciliation (`transactions.service.reconcile_account`)
    writes `real balance - current balance`. It conflicts with the `FOR SHARE` of every writer of
    movements and with itself: a movement in flight makes this wait until it commits (and the
    balance read afterwards includes it), a movement that starts later waits for this transaction,
    and two reconciliations of the same account run one after the other (the second one reads the
    balance of the first and finds no difference). It is also the lock the archive takes, so the
    two are serialised. Archived accounts too.

    It returns a schema, so the caller cannot UPDATE the row; asking for `FOR SHARE` afterwards in
    the same transaction (`create_transaction` does) is free, because a transaction's own locks
    never conflict and `FOR NO KEY UPDATE` is the stronger one. See `repository.get_for_update`.
    """
    return AccountRead.model_validate(await _get_for_update_or_raise(session, space_id, account_id))


async def _get_for_update_or_raise(
    session: AsyncSession, space_id: uuid.UUID, account_id: uuid.UUID
) -> Account:
    account = await repository.get_for_update(session, space_id=space_id, account_id=account_id)
    if account is None:
        raise NotFoundError("account_not_found", "Account not found")
    return account


async def _get_or_raise(
    session: AsyncSession, space_id: uuid.UUID, account_id: uuid.UUID
) -> Account:
    account = await repository.get(session, space_id=space_id, account_id=account_id)
    if account is None:
        raise NotFoundError("account_not_found", "Account not found")
    return account

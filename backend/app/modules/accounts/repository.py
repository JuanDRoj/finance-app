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


async def get_for_share(
    session: AsyncSession, *, space_id: uuid.UUID, account_id: uuid.UUID
) -> Account | None:
    """Like `get`, but locks the row `FOR SHARE` until the end of the transaction.

    For a writer that checks the state of an account (is it active?) before it writes rows that
    depend on it: the entries of a movement. The foreign key of an entry only takes `FOR KEY
    SHARE`, which does not conflict with the UPDATE that archives the account, so without this lock
    an archive could run between the check and the write and leave an archived account with a
    balance. `FOR SHARE` conflicts with that UPDATE (and with the `FOR NO KEY UPDATE` an archive
    reads the account with): if an archive is in flight this waits for it and, in READ COMMITTED,
    then reads the archived row; if this goes first, the archive waits and then sees the balance.
    It does not conflict with another `FOR SHARE`, so two movements on one account do not wait for
    each other. **Never UPDATE a row read this way in the same transaction**: two transactions that
    hold the share and both try to update it would deadlock.

    `populate_existing` makes the read reflect the row as it is now, not as the session saw it.
    """
    stmt = (
        _in_space(space_id)
        .where(Account.id == account_id)
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    )
    return await session.scalar(stmt)


async def get_for_update(
    session: AsyncSession, *, space_id: uuid.UUID, account_id: uuid.UUID
) -> Account | None:
    """Like `get`, but locks the row `FOR NO KEY UPDATE` until the end of the transaction.

    For a writer that reads an account and then updates that same row (archive, unarchive). It
    conflicts with the `FOR SHARE` that every writer of movements takes on its accounts
    (`get_for_share`), so an archive and a movement on the same account never overlap: whoever
    goes second waits for the first one to end and, in READ COMMITTED, reads what it committed.
    That is what lets the archive read the balance **after** this lock and trust it. Two archives
    of the same account are serialised too: the second one finds it archived and does not overwrite
    `archived_at`. It is the lock the UPDATE takes anyway, so it blocks nothing more than the UPDATE
    would (`FOR UPDATE` would also stop the foreign key checks of `entries`).

    `populate_existing` makes the read reflect the row as it is now, not as the session saw it.
    """
    stmt = (
        _in_space(space_id)
        .where(Account.id == account_id)
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )
    return await session.scalar(stmt)


async def list_for_space(
    session: AsyncSession, *, space_id: uuid.UUID, include_archived: bool
) -> list[Account]:
    """The accounts of the space ordered by name; the archived ones only if asked for."""
    stmt = _in_space(space_id).order_by(Account.name, Account.id)
    if not include_archived:
        stmt = stmt.where(Account.archived_at.is_(None))
    return list(await session.scalars(stmt))

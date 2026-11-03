import uuid
from collections.abc import Collection, Iterable
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, InvalidFieldError, NotFoundError
from app.core.schemas import MAX_SAFE_INTEGER
from app.modules.accounts import service as accounts_service
from app.modules.accounts.schemas import AccountRead
from app.modules.categories import service as categories_service
from app.modules.categories.schemas import CategoryRead
from app.modules.spaces import service as spaces_service
from app.modules.transactions import repository
from app.modules.transactions.cursor import decode_cursor, encode_cursor, month_bounds
from app.modules.transactions.entries import build_entries, referenced_accounts
from app.modules.transactions.idempotency import IDEMPOTENCY_KEY_TTL, request_fingerprint
from app.modules.transactions.models import Entry, Transaction
from app.modules.transactions.movement_view import as_list_item, build_movement
from app.modules.transactions.schemas import (
    ACCOUNT_ARCHIVED,
    ACCOUNT_NOT_FOUND,
    BALANCE_OUT_OF_RANGE,
    CATEGORY_ARCHIVED,
    CATEGORY_KIND_MISMATCH,
    CATEGORY_NOT_FOUND,
    IDEMPOTENCY_KEY_REUSED,
    TRANSACTION_NOT_EDITABLE,
    TRANSACTION_NOT_FOUND,
    AdjustmentCreate,
    BalanceSummaryRead,
    ExpenseCreate,
    IncomeCreate,
    MovementCreate,
    MovementPage,
    MovementRead,
    TransactionCreate,
    TransactionFilters,
    TransactionListFilters,
    TransactionRead,
    TransactionSummaryRead,
)

# What a person registers by hand (`MovementCreate`): the only types the API edits and deletes.
_REGISTERED_TYPES = ("expense", "income", "transfer")

# Callers (the router) are already known to belong to the space: `require_space_member` ran first.
# Every query still filters by `space_id`, so an id from another space is a plain "not found".


async def create_transaction(
    session: AsyncSession, space_id: uuid.UUID, user_id: uuid.UUID, data: TransactionCreate
) -> TransactionRead:
    """Create a confirmed movement and its entries; the client never sends the entries.

    The accounts (and, for an expense or an income, the category) must exist in the space and be
    active, and the category must be of the kind of the movement; otherwise a 422 names the field.
    Its `loc` is `("body", <type>, <field>)`, the same as the errors of the request body (a
    discriminated union: Pydantic puts the type in the location), so the frontend finds one path
    per field whichever rule rejected it.
    A principal category that has subcategories is a valid destination. The accounts are read
    `FOR SHARE`, in a fixed order (by id), and stay locked until the request ends: see
    `accounts.service.get_account_for_share` for what that protects (an account cannot be archived
    with a balance by a movement that was being written). The category is read without a lock: a
    movement created at the very moment the category is archived is the same as one created just
    before, and the old movements keep their category anyway.

    A new movement is always `confirmed`: pending and skipped ones come from the recurring
    templates. Each entry gets the space of the transaction from the relationship.
    """
    await _check_accounts(session, space_id, data)
    await _check_category(session, space_id, data)
    transaction = Transaction(
        id=uuid.uuid7(),
        space_id=space_id,
        type=data.type,
        status="confirmed",
        date=data.date,
        description=data.description,
        created_by=user_id,
    )
    transaction.entries = _entries_for(data)
    session.add(transaction)
    # One flush writes the transaction and then its entries (the relationship orders them).
    await session.flush()
    return TransactionRead.model_validate(transaction)


async def update_transaction(
    session: AsyncSession,
    space_id: uuid.UUID,
    transaction_id: uuid.UUID,
    data: MovementCreate,
    *,
    now: datetime,
) -> MovementRead:
    """Replace a movement with `data`: type, date, description and its entries, rebuilt.

    What `PUT /spaces/{id}/transactions/{transaction_id}` does. The body is the whole movement, as
    in the creation: an omitted `description` clears the note, and the type may change among
    expense, income and transfer (the entries are made again from scratch by `build_entries`; the
    old ones are deleted). The id, the creator, the creation date and the status stay.

    Only a confirmed expense, income or transfer can be edited (409 `transaction_not_editable`
    otherwise: adjustments are made by the system, pending and skipped ones belong to the recurring
    flow); a deleted one is a 404, like in the detail. The order of things matters:

    1. The transaction row is read `FOR NO KEY UPDATE`, so edit, delete and restore of the same
       movement run one after the other.
    2. The accounts of the old entries **and** of the new ones are read `FOR SHARE`, in order of id
       (`_lock_accounts`): both balances change, and reconcile and archive decide from a balance.
    3. Everything is validated before a row changes, so a refused edit leaves the movement as it
       was. An account of the body must exist and be active (422 on its field, as in the creation,
       even if the movement already had it); an account that is only in the old entries must be
       active too (409 `account_archived`: an archived account cannot change its balance). The
       category is checked as in the creation, except that the archived category the movement
       already has may stay: old movements keep their archived categories.
    4. The transaction and its entries are written; `updated_at` is `now` (it has to be written
       because an edit that only changes the entries would not touch the row).
    """
    transaction = await _lock_transaction(session, space_id, transaction_id)
    if transaction.deleted_at is not None:
        raise _not_found()
    _require_editable(transaction)
    stored = {entry.account_id for entry in transaction.entries}
    stored_category = next(
        (entry.category_id for entry in transaction.entries if entry.category_id is not None), None
    )
    await _check_accounts(session, space_id, data, stored=stored)
    await _check_category(session, space_id, data, current=stored_category)
    transaction.type = data.type
    transaction.date = data.date
    transaction.description = data.description
    transaction.updated_at = now
    transaction.entries = _entries_for(data)
    await session.flush()
    return await get_movement(session, space_id, transaction_id)


async def delete_transaction(
    session: AsyncSession, space_id: uuid.UUID, transaction_id: uuid.UUID, *, now: datetime
) -> None:
    """Soft-delete a movement (`deleted_at`): it stops counting in balances, lists and totals.

    What `DELETE /spaces/{id}/transactions/{transaction_id}` does. Its entries stay, so
    `restore_transaction` brings it back as it was. Deleting one that is already deleted changes
    nothing (it keeps its first `deleted_at`). Same rule as the edit for what can be deleted (409
    `transaction_not_editable`) and the same locks (the transaction, then its accounts `FOR SHARE`),
    so a reconciliation that decides from the balance waits for the delete and reads the balance
    after it. The accounts must be active (409 `account_archived`).
    """
    transaction = await _lock_transaction(session, space_id, transaction_id)
    _require_editable(transaction)
    if transaction.deleted_at is not None:
        return
    await _lock_active_accounts(session, space_id, transaction)
    transaction.deleted_at = now
    transaction.updated_at = now
    await session.flush()


async def restore_transaction(
    session: AsyncSession, space_id: uuid.UUID, transaction_id: uuid.UUID, *, now: datetime
) -> MovementRead:
    """Undo a delete: the movement comes back with its id, date and entries, and counts again.

    What `POST /spaces/{id}/transactions/{transaction_id}/restore` does. Restoring one that is not
    deleted changes nothing. The accounts are read `FOR SHARE` and must be active (409
    `account_archived`): the movement puts money back on them, and an archive that ran in between
    (possible because the balance was 0 while it was deleted) must not end with a balance. If the
    archive is in flight, whoever goes second sees the other: the archive sees the balance (409
    `account_has_balance`) or this sees the archived account.
    """
    transaction = await _lock_transaction(session, space_id, transaction_id)
    _require_editable(transaction)
    if transaction.deleted_at is not None:
        await _lock_active_accounts(session, space_id, transaction)
        transaction.deleted_at = None
        transaction.updated_at = now
        await session.flush()
    return await get_movement(session, space_id, transaction_id)


async def create_movement(
    session: AsyncSession,
    space_id: uuid.UUID,
    user_id: uuid.UUID,
    data: MovementCreate,
    *,
    idempotency_key: uuid.UUID | None,
    now: datetime,
) -> TransactionRead:
    """What `POST /spaces/{id}/transactions` does: `create_transaction`, once per `Idempotency-Key`.

    Without a key it is exactly `create_transaction`. With one, the key is unique per
    `(space, user, key)`, and the order of things is what makes two requests with the same key
    (a double tap, a retry after a lost response) create one movement:

    1. The key is **claimed first** (`claim_idempotency_key`, one atomic `INSERT ... ON CONFLICT`),
       before any account is locked. A second request with the same key waits there until the
       first one ends; while it waits it holds no lock (it has only read). If the first one rolled
       back (a 422, say), the key never existed and the second one goes on as the owner; if it
       committed, the second one finds the key.
    2. If the key was already live, no data is written, but the claim leaves that key row locked
       (`FOR NO KEY UPDATE`: PostgreSQL locks the conflicting row even when the `WHERE` of the
       `DO UPDATE` is false) until the request ends. It is harmless: nothing else is locked
       afterwards (a replay only reads), and the only effect is that two replays of the same key
       in flight run one after the other. The same body answers with the movement the key created
       (read again by id, so it is the movement as it is now, deleted or not, and it is not
       validated again), and another body is a 409 `idempotency_key_reused`.
    3. Otherwise the movement is created as always and the key is tied to it (`transaction_id`),
       all in the transaction of the request, so the key exists if and only if the movement does.

    A request that fails leaves no key (the whole transaction rolls back), so a corrected retry may
    use the same key. A key is live for `IDEMPOTENCY_KEY_TTL` counted from `now`; an expired one is
    replaced by the new claim, whatever its body was.
    """
    if idempotency_key is None:
        return await create_transaction(session, space_id, user_id, data)
    fingerprint = request_fingerprint(data)
    claimed = await repository.claim_idempotency_key(
        session,
        space_id=space_id,
        user_id=user_id,
        key=idempotency_key,
        request_hash=fingerprint,
        now=now,
        expired_before=now - IDEMPOTENCY_KEY_TTL,
    )
    if not claimed:
        return await _replay(session, space_id, user_id, idempotency_key, fingerprint)
    created = await create_transaction(session, space_id, user_id, data)
    await repository.attach_idempotency_key(
        session, space_id=space_id, user_id=user_id, key=idempotency_key, transaction_id=created.id
    )
    return created


async def _replay(
    session: AsyncSession,
    space_id: uuid.UUID,
    user_id: uuid.UUID,
    key: uuid.UUID,
    fingerprint: bytes,
) -> TransactionRead:
    """The answer for a key that is already live: its movement, or a 409 if the body differs."""
    stored = await repository.get_idempotency_key(
        session, space_id=space_id, user_id=user_id, key=key
    )
    if stored is None or stored.transaction_id is None:
        # The claim saw a committed row, which always has its movement: not reachable unless the
        # invariant is broken. That is a bug (500 with a trace), not something to tell the client.
        raise RuntimeError("An idempotency key that is live has no movement")
    if stored.request_hash != fingerprint:
        raise ConflictError(
            IDEMPOTENCY_KEY_REUSED,
            "This Idempotency-Key was already used with a different request body",
        )
    transaction = await repository.get_with_entries(
        session, space_id=space_id, transaction_id=stored.transaction_id
    )
    if transaction is None:
        raise RuntimeError("An idempotency key points at a movement that does not exist")
    return TransactionRead.model_validate(transaction)


async def create_adjustment(
    session: AsyncSession,
    space_id: uuid.UUID,
    user_id: uuid.UUID,
    account_id: uuid.UUID,
    amount_minor: int,
    *,
    now: datetime,
) -> TransactionRead:
    """Create a confirmed adjustment of the balance of one account: initial balance, reconciliation.

    `amount_minor` is the change of the balance with its sign, never zero and within the safe
    limit (the callers guarantee both; otherwise it is a bug and Pydantic raises). On a credit card
    a negative amount raises the debt. An adjustment is neither income nor expense: no category,
    no description (the UI labels it by type). Its date is the local day of the space at `now`
    (`spaces.timezone`), so the same code dates every adjustment. It goes through
    `create_transaction`, so the account must exist in the space and be active (otherwise a 422
    with `loc` `("body", "adjustment", "account_id")`, like any movement) and is read `FOR SHARE`.
    In practice that 422 never reaches a client: the initial balance creates the account in the
    same transaction, and the reconciliation answers 409 `account_archived` (or 404) first.
    """
    timezone = await spaces_service.get_space_timezone(session, space_id)
    day = now.astimezone(ZoneInfo(timezone)).date()
    data = AdjustmentCreate(
        type="adjustment", date=day, account_id=account_id, amount_minor=amount_minor
    )
    return await create_transaction(session, space_id, user_id, data)


async def reconcile_account(
    session: AsyncSession,
    space_id: uuid.UUID,
    user_id: uuid.UUID,
    account_id: uuid.UUID,
    *,
    balance_minor: int,
    now: datetime,
) -> TransactionRead | None:
    """Match the balance of an account to the real one with an adjustment for the difference.

    `balance_minor` is the real balance with the sign of `balance_minor` of the API (on a credit
    card, negative = you owe), so the adjustment is always `real - current`, whatever the type of
    the account. If there is no difference nothing is written and the result is None. The account
    must exist in the space (404) and be active (409 `account_archived`, checked even when there is
    no difference). A difference beyond the safe limit is a 422 on `balance_minor` (the CHECK
    `ck_entries_amount_range` would otherwise answer with a 500).

    The account is read `FOR NO KEY UPDATE` and only then the balance (the same order as the
    archive): the adjustment depends on that balance, so nobody else may write between the two. A
    movement in flight is waited for, and the balance read afterwards includes it, so the account
    ends at exactly the real balance; a movement that starts later waits for this transaction and
    goes after it. Two reconciliations at the same time (a double tap) run one after the other: the
    second one reads the balance the first one committed and, with the same real balance, finds no
    difference and writes nothing. The `FOR SHARE` that `create_transaction` takes on the same
    account afterwards does not wait: a transaction's own locks never conflict.
    """
    account = await accounts_service.get_account_for_update(session, space_id, account_id)
    if account.archived_at is not None:
        raise ConflictError(ACCOUNT_ARCHIVED, "The account is archived")
    current = await repository.balance_of_account(session, space_id=space_id, account_id=account_id)
    difference = balance_minor - current
    if difference == 0:
        return None
    if abs(difference) > MAX_SAFE_INTEGER:
        raise InvalidFieldError(
            ("body", "balance_minor"),
            BALANCE_OUT_OF_RANGE,
            "The difference with the current balance is too large",
        )
    return await create_adjustment(session, space_id, user_id, account_id, difference, now=now)


async def get_account_balance(
    session: AsyncSession, space_id: uuid.UUID, account_id: uuid.UUID
) -> int:
    """Sum of the confirmed, not deleted entries of the account (0 if it has none)."""
    return await repository.balance_of_account(session, space_id=space_id, account_id=account_id)


async def get_account_balances(session: AsyncSession, space_id: uuid.UUID) -> dict[uuid.UUID, int]:
    """The balance of every account that has entries; use `.get(id, 0)` for the others."""
    return await repository.balances_by_account(session, space_id=space_id)


async def space_has_transactions(session: AsyncSession, space_id: uuid.UUID) -> bool:
    """True if the space has any transaction: pending, skipped and deleted ones included.

    For the rule of the currency of the space (`spaces.service.update_space`): once money has been
    written in the space, its currency is fixed. Nothing else should read it as "has balance".
    """
    return await repository.space_has_transactions(session, space_id=space_id)


async def get_balance_summary(session: AsyncSession, space_id: uuid.UUID) -> BalanceSummaryRead:
    """Available (bank and cash), card debt and net of the space.

    Archived accounts count too: their money is still money (it is normally 0 by the archive rule).
    Pending, skipped and deleted movements never count. The debt is the opposite of the sum of the
    credit cards' balances and is not clamped, so `net = available - debt` always equals the sum of
    every balance, and a transfer (which adds up to zero) never changes it.
    """
    balances = await repository.balances_by_account(session, space_id=space_id)
    accounts = await accounts_service.list_accounts(session, space_id, include_archived=True)
    available = sum(balances.get(a.id, 0) for a in accounts if a.type in ("bank", "cash"))
    cards = sum(balances.get(a.id, 0) for a in accounts if a.type == "credit_card")
    return BalanceSummaryRead(
        available_minor=available, card_debt_minor=-cards, net_minor=available + cards
    )


async def list_movements(
    session: AsyncSession, space_id: uuid.UUID, filters: TransactionListFilters
) -> MovementPage:
    """One page of the movements of the space, newest first (`date desc, id desc`).

    Deleted movements are left out; pending and skipped ones are listed with their `status`. Each
    item carries its account(s) and category with name and icon. With an `account_id` filter every
    item also carries `balance_after_minor`, the balance of that account right after it.
    Statements per page do not depend on its size: the page, its entries, the accounts and the
    categories of the space and, with an account filter, the running balance.
    """
    criteria = await _criteria(session, space_id, filters)
    after = decode_cursor(filters.cursor) if filters.cursor is not None else None
    rows = await repository.list_page(
        session, space_id=space_id, criteria=criteria, after=after, limit=filters.limit + 1
    )
    shown = rows[: filters.limit]
    next_cursor = encode_cursor(shown[-1].date, shown[-1].id) if len(rows) > filters.limit else None
    accounts, categories = await _lookups(session, space_id)
    balances: dict[uuid.UUID, int] = {}
    if filters.account_id is not None:
        balances = await repository.balances_after(
            session,
            space_id=space_id,
            account_id=filters.account_id,
            transaction_ids=[row.id for row in shown],
        )
    items = [
        as_list_item(build_movement(row, accounts, categories), balances.get(row.id))
        for row in shown
    ]
    return MovementPage(items=items, next_cursor=next_cursor)


async def get_movement(
    session: AsyncSession, space_id: uuid.UUID, transaction_id: uuid.UUID
) -> MovementRead:
    """One movement of the space, as the list shows it. Deleted ones are not found (404)."""
    row = await repository.get_active_with_entries(
        session, space_id=space_id, transaction_id=transaction_id
    )
    if row is None:
        raise NotFoundError(TRANSACTION_NOT_FOUND, "Transaction not found")
    accounts, categories = await _lookups(session, space_id)
    return build_movement(row, accounts, categories)


async def get_movements_summary(
    session: AsyncSession, space_id: uuid.UUID, filters: TransactionFilters
) -> TransactionSummaryRead:
    """What the filtered period adds up to: income, expense, what is left and how many rows.

    Same filters as the list, `type` included, so the figures match the table. Income and expense
    count only confirmed incomes and expenses; `count` is every row the list would show.
    """
    criteria = await _criteria(session, space_id, filters)
    total = await repository.count(session, space_id=space_id, criteria=criteria)
    income, expense = await repository.income_and_expense(
        session, space_id=space_id, criteria=criteria
    )
    return TransactionSummaryRead(
        count=total, income_minor=income, expense_minor=expense, remaining_minor=income - expense
    )


async def _criteria(
    session: AsyncSession, space_id: uuid.UUID, filters: TransactionFilters
) -> repository.ListCriteria:
    """The filters as the repository takes them: the month as a range, the category resolved."""
    category_ids = None
    if filters.category_id is not None:
        category_ids = await categories_service.category_ids_with_subcategories(
            session, space_id, filters.category_id
        )
    return repository.ListCriteria(
        month=month_bounds(filters.month) if filters.month is not None else None,
        type=filters.type,
        account_id=filters.account_id,
        category_ids=category_ids,
        search=filters.q,
    )


async def _lookups(
    session: AsyncSession, space_id: uuid.UUID
) -> tuple[dict[uuid.UUID, AccountRead], dict[uuid.UUID, CategoryRead]]:
    """Every account and category of the space by id, archived ones included.

    A movement keeps its archived account and category, and the lists are small (dozens of rows),
    so two queries serve any page instead of a lookup per item.
    """
    accounts = await accounts_service.list_accounts(session, space_id, include_archived=True)
    categories = await categories_service.list_category_reads(
        session, space_id, include_archived=True
    )
    return (
        {account.id: account for account in accounts},
        {category.id: category for category in categories},
    )


def _entries_for(data: TransactionCreate) -> list[Entry]:
    """The entries of a movement as `build_entries` decides them, with ids made in order.

    The ids are generated here, in order, so the entries read back in the order they were built.
    """
    return [
        Entry(
            id=uuid.uuid7(),
            account_id=draft.account_id,
            amount_minor=draft.amount_minor,
            category_id=draft.category_id,
        )
        for draft in build_entries(data)
    ]


def _not_found() -> NotFoundError:
    return NotFoundError(TRANSACTION_NOT_FOUND, "Transaction not found")


async def _lock_transaction(
    session: AsyncSession, space_id: uuid.UUID, transaction_id: uuid.UUID
) -> Transaction:
    """The transaction of the space (deleted or not) read `FOR NO KEY UPDATE`, or a 404."""
    transaction = await repository.get_for_update(
        session, space_id=space_id, transaction_id=transaction_id
    )
    if transaction is None:
        raise _not_found()
    return transaction


def _require_editable(transaction: Transaction) -> None:
    """Only a confirmed expense, income or transfer is changed through the API (409 otherwise)."""
    if transaction.type not in _REGISTERED_TYPES or transaction.status != "confirmed":
        raise ConflictError(
            TRANSACTION_NOT_EDITABLE,
            "Only a confirmed expense, income or transfer can be edited, deleted or restored",
        )


async def _lock_accounts(
    session: AsyncSession, space_id: uuid.UUID, account_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, AccountRead | None]:
    """Read each account `FOR SHARE`, in order of id; `None` = not in the space.

    Lock order: by id, so two movements over the same accounts never cross. SHARE locks do not
    conflict with each other anyway; the order protects the day an operation takes a stronger one.
    """
    accounts: dict[uuid.UUID, AccountRead | None] = {}
    for account_id in sorted(set(account_ids)):
        try:
            accounts[account_id] = await accounts_service.get_account_for_share(
                session, space_id, account_id
            )
        except NotFoundError:
            accounts[account_id] = None
    return accounts


def _require_active(
    accounts: dict[uuid.UUID, AccountRead | None], ids: Collection[uuid.UUID]
) -> None:
    """409 if any of these (stored) accounts is archived: its balance cannot change."""
    if any((account := accounts[i]) is not None and account.archived_at is not None for i in ids):
        raise ConflictError(ACCOUNT_ARCHIVED, "An account of this movement is archived")


async def _lock_active_accounts(
    session: AsyncSession, space_id: uuid.UUID, transaction: Transaction
) -> None:
    """Lock the accounts of the entries of a stored movement and require them to be active."""
    ids = {entry.account_id for entry in transaction.entries}
    _require_active(await _lock_accounts(session, space_id, ids), ids)


async def _check_accounts(
    session: AsyncSession,
    space_id: uuid.UUID,
    data: TransactionCreate,
    *,
    stored: Collection[uuid.UUID] = (),
) -> None:
    """Lock and validate the accounts of the body; `stored` are the ones an edit takes money from.

    The accounts of the body must exist in the space and be active (422 on the field, whatever the
    movement had before). `stored` ones are locked too, in the same order, but they are not in the
    body, so an archived one is a 409.
    """
    references = referenced_accounts(data)
    accounts = await _lock_accounts(
        session, space_id, [account_id for _, account_id in references] + list(stored)
    )
    for field, account_id in references:
        account = accounts[account_id]
        loc = ("body", data.type, field)
        if account is None:
            raise InvalidFieldError(loc, ACCOUNT_NOT_FOUND, "Account not found")
        if account.archived_at is not None:
            raise InvalidFieldError(loc, ACCOUNT_ARCHIVED, "The account is archived")
    in_body = {account_id for _, account_id in references}
    _require_active(accounts, [account_id for account_id in stored if account_id not in in_body])


async def _check_category(
    session: AsyncSession,
    space_id: uuid.UUID,
    data: TransactionCreate,
    *,
    current: uuid.UUID | None = None,
) -> None:
    """The category of an expense or an income: it exists, is of its kind and is active.

    `current` is the category the movement already has (an edit): if it is sent again it may be
    archived, because old movements keep their archived categories and the person could not even
    change the note otherwise. Any other archived category is refused.
    """
    if not isinstance(data, ExpenseCreate | IncomeCreate):
        return  # a transfer and an adjustment have no category
    loc = ("body", data.type, "category_id")
    try:
        category = await categories_service.get_category(session, space_id, data.category_id)
    except NotFoundError:
        raise InvalidFieldError(loc, CATEGORY_NOT_FOUND, "Category not found") from None
    if category.kind != data.type:  # the kinds are named like the types: "expense" and "income"
        raise InvalidFieldError(
            loc, CATEGORY_KIND_MISMATCH, "The category is not of the kind of this movement"
        )
    if category.archived_at is not None and category.id != current:
        raise InvalidFieldError(loc, CATEGORY_ARCHIVED, "The category is archived")

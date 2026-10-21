import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, InvalidFieldError, NotFoundError
from app.core.schemas import MAX_SAFE_INTEGER
from app.modules.accounts import service as accounts_service
from app.modules.categories import service as categories_service
from app.modules.spaces import service as spaces_service
from app.modules.transactions import repository
from app.modules.transactions.entries import build_entries, referenced_accounts
from app.modules.transactions.models import Entry, Transaction
from app.modules.transactions.schemas import (
    ACCOUNT_ARCHIVED,
    ACCOUNT_NOT_FOUND,
    BALANCE_OUT_OF_RANGE,
    CATEGORY_ARCHIVED,
    CATEGORY_KIND_MISMATCH,
    CATEGORY_NOT_FOUND,
    AdjustmentCreate,
    BalanceSummaryRead,
    ExpenseCreate,
    IncomeCreate,
    TransactionCreate,
    TransactionRead,
)

# Callers (the router) are already known to belong to the space: `require_space_member` ran first.
# Every query still filters by `space_id`, so an id from another space is a plain "not found".


async def create_transaction(
    session: AsyncSession, space_id: uuid.UUID, user_id: uuid.UUID, data: TransactionCreate
) -> TransactionRead:
    """Create a confirmed movement and its entries; the client never sends the entries.

    The accounts (and, for an expense or an income, the category) must exist in the space and be
    active, and the category must be of the kind of the movement; otherwise a 422 names the field.
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
    # Ids are generated here, in order, so the entries read back in the order they were built.
    transaction.entries = [
        Entry(
            id=uuid.uuid7(),
            account_id=draft.account_id,
            amount_minor=draft.amount_minor,
            category_id=draft.category_id,
        )
        for draft in build_entries(data)
    ]
    session.add(transaction)
    # One flush writes the transaction and then its entries (the relationship orders them).
    await session.flush()
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
    `create_transaction`, so the account must exist in the space and be active (a 422 on
    `account_id` otherwise) and is read `FOR SHARE`.
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


async def _check_accounts(
    session: AsyncSession, space_id: uuid.UUID, data: TransactionCreate
) -> None:
    references = referenced_accounts(data)
    archived: dict[uuid.UUID, bool | None] = {}  # None = not in the space
    # Lock order: by id, so two movements over the same accounts never cross. SHARE locks do not
    # conflict with each other anyway; the order protects the day an operation takes a stronger one.
    for account_id in sorted({account_id for _, account_id in references}):
        try:
            account = await accounts_service.get_account_for_share(session, space_id, account_id)
        except NotFoundError:
            archived[account_id] = None
        else:
            archived[account_id] = account.archived_at is not None
    for field, account_id in references:
        state = archived[account_id]
        if state is None:
            raise InvalidFieldError(("body", field), ACCOUNT_NOT_FOUND, "Account not found")
        if state:
            raise InvalidFieldError(("body", field), ACCOUNT_ARCHIVED, "The account is archived")


async def _check_category(
    session: AsyncSession, space_id: uuid.UUID, data: TransactionCreate
) -> None:
    if not isinstance(data, ExpenseCreate | IncomeCreate):
        return  # a transfer and an adjustment have no category
    loc = ("body", "category_id")
    try:
        category = await categories_service.get_category(session, space_id, data.category_id)
    except NotFoundError:
        raise InvalidFieldError(loc, CATEGORY_NOT_FOUND, "Category not found") from None
    if category.kind != data.type:  # the kinds are named like the types: "expense" and "income"
        raise InvalidFieldError(
            loc, CATEGORY_KIND_MISMATCH, "The category is not of the kind of this movement"
        )
    if category.archived_at is not None:
        raise InvalidFieldError(loc, CATEGORY_ARCHIVED, "The category is archived")

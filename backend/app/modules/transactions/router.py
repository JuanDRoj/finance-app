import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, status

from app.core.db import DbSession
from app.core.errors import ErrorResponse
from app.modules.spaces.dependencies import SpaceMember, require_space_member
from app.modules.transactions import service
from app.modules.transactions.schemas import (
    BalanceSummaryRead,
    MovementCreate,
    MovementPage,
    MovementRead,
    TransactionFilters,
    TransactionListFilters,
    TransactionRead,
    TransactionSummaryRead,
)

# Creating, listing and reading a movement, its summary and the balance summary are served here so
# far. Editing and deleting movements over HTTP is still to do.
router = APIRouter(
    prefix="/spaces/{space_id}/transactions",
    tags=["transactions"],
    dependencies=[Depends(require_space_member)],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)

# The header is optional: without it the request behaves as it always did. Any UUID version is
# accepted (a browser's `crypto.randomUUID()` is a v4); a value that is not a UUID is a 422 on the
# header. The case and the hyphens of the UUID do not matter: it is stored as a UUID.
IdempotencyKeyHeader = Annotated[
    uuid.UUID | None,
    Header(
        alias="Idempotency-Key",
        description=(
            "A UUID the client generates for each attempt to register a movement, and reuses when "
            "it retries the same request (a double tap, a lost response). With the same key, user "
            "and space, a repeated request creates nothing and answers 201 with the same movement; "
            "the same key with another body is a 409 `idempotency_key_reused`. A key counts for "
            "24 hours. A request that fails (4xx or 5xx) does not use the key."
        ),
    ),
]

balance_router = APIRouter(
    prefix="/spaces/{space_id}/balance-summary",
    tags=["balances"],
    dependencies=[Depends(require_space_member)],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=TransactionRead,
    responses={409: {"model": ErrorResponse}},
)
async def create_transaction(
    space_id: uuid.UUID,
    data: MovementCreate,
    session: DbSession,
    member: SpaceMember,
    idempotency_key: IdempotencyKeyHeader = None,
) -> TransactionRead:
    """Register an expense, an income or a transfer; the backend builds the entries.

    The body depends on `type`. An expense and an income take an account, a category of their kind
    and a positive amount; a transfer takes two different accounts (paying a card is a transfer)
    and a positive amount. `amount_minor` is always positive, in the minor unit of the currency of
    the space: the backend applies the sign (on a credit card an expense raises the debt and a
    transfer from a bank lowers it). The movement is born `confirmed`.

    Accounts and categories must belong to the space and be active, or a 422 names the field
    (`loc` is `["body", "<type>", "<field>"]`): an id of another space answers like one that does
    not exist.

    With the optional `Idempotency-Key` header the request can be repeated safely: the same key
    (same user and space) with the same body creates nothing and answers 201 with the same
    movement; with another body it is a 409 `idempotency_key_reused`. The header must be a UUID
    (422 on the header otherwise).
    """
    return await service.create_movement(
        session,
        space_id,
        member.user_id,
        data,
        idempotency_key=idempotency_key,
        now=datetime.now(UTC),
    )


@router.get("", status_code=status.HTTP_200_OK, response_model=MovementPage)
async def list_transactions(
    space_id: uuid.UUID, filters: Annotated[TransactionListFilters, Query()], session: DbSession
) -> MovementPage:
    """The movements of the space, newest first, one page at a time (cursor).

    Order: `date` descending, then `id` descending. `next_cursor` is opaque: send it back as
    `cursor` (with the same filters) for the next page; it is null on the last one. `limit` is 1
    to 100 (50 by default). Filters, all optional and combined: `month` (`YYYY-MM`, on the local
    date), `type`, `account_id`, `category_id` (a main category includes its subcategories) and
    `q` (the description, ignoring case and accents). An account or category that does not exist
    or is of another space matches nothing. Deleted movements are never listed; pending and
    skipped ones are, with their `status`.

    Amounts are in the minor unit of the currency of the space. `amount_minor` is negative for an
    expense, positive for an income, signed for an adjustment and unsigned for a transfer. With
    `account_id`, each item also has `balance_after_minor`, the balance of that account right
    after it (negative = debt on a credit card).
    """
    return await service.list_movements(session, space_id, filters)


@router.get("/summary", status_code=status.HTTP_200_OK, response_model=TransactionSummaryRead)
async def read_transactions_summary(
    space_id: uuid.UUID, filters: Annotated[TransactionFilters, Query()], session: DbSession
) -> TransactionSummaryRead:
    """Income, expense, what is left and the number of movements of the filtered period.

    The same filters as the list (without `limit` nor `cursor`), `type` included. Only confirmed
    incomes and expenses add up; adjustments and transfers do not. `count` is the number of
    movements the list shows for those filters, for "showing n of m".
    """
    return await service.get_movements_summary(session, space_id, filters)


@router.get(
    "/{transaction_id}",
    status_code=status.HTTP_200_OK,
    response_model=MovementRead,
)
async def read_transaction(
    space_id: uuid.UUID, transaction_id: uuid.UUID, session: DbSession
) -> MovementRead:
    """One movement of the space, with the same shape as an item of the list.

    A deleted one, one of another space and one that does not exist are the same 404.
    """
    return await service.get_movement(session, space_id, transaction_id)


@balance_router.get("", status_code=status.HTTP_200_OK, response_model=BalanceSummaryRead)
async def read_balance_summary(space_id: uuid.UUID, session: DbSession) -> BalanceSummaryRead:
    """Available (bank and cash), card debt and net of the space, in its currency's minor unit."""
    return await service.get_balance_summary(session, space_id)

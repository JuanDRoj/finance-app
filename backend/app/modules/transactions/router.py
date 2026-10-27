import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, status

from app.core.db import DbSession
from app.core.errors import ErrorResponse
from app.modules.spaces.dependencies import SpaceMember, require_space_member
from app.modules.transactions import service
from app.modules.transactions.schemas import BalanceSummaryRead, MovementCreate, TransactionRead

# Creating a movement and the balance summary are served here so far. Listing, editing and deleting
# movements over HTTP is still to do.
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


@balance_router.get("", status_code=status.HTTP_200_OK, response_model=BalanceSummaryRead)
async def read_balance_summary(space_id: uuid.UUID, session: DbSession) -> BalanceSummaryRead:
    """Available (bank and cash), card debt and net of the space, in its currency's minor unit."""
    return await service.get_balance_summary(session, space_id)

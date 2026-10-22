import uuid

from fastapi import APIRouter, Depends, status

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

balance_router = APIRouter(
    prefix="/spaces/{space_id}/balance-summary",
    tags=["balances"],
    dependencies=[Depends(require_space_member)],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)


@router.post("", status_code=status.HTTP_201_CREATED, response_model=TransactionRead)
async def create_transaction(
    space_id: uuid.UUID, data: MovementCreate, session: DbSession, member: SpaceMember
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
    """
    return await service.create_transaction(session, space_id, member.user_id, data)


@balance_router.get("", status_code=status.HTTP_200_OK, response_model=BalanceSummaryRead)
async def read_balance_summary(space_id: uuid.UUID, session: DbSession) -> BalanceSummaryRead:
    """Available (bank and cash), card debt and net of the space, in its currency's minor unit."""
    return await service.get_balance_summary(session, space_id)

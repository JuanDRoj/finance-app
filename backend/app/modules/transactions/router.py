import uuid

from fastapi import APIRouter, Depends, status

from app.core.db import DbSession
from app.core.errors import ErrorResponse
from app.modules.spaces.dependencies import require_space_member
from app.modules.transactions import service
from app.modules.transactions.schemas import BalanceSummaryRead

# The routes of the movements themselves (create, list, edit, delete) arrive with BE-16 and BE-18.
router = APIRouter(
    prefix="/spaces/{space_id}/balance-summary",
    tags=["balances"],
    dependencies=[Depends(require_space_member)],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)


@router.get("", status_code=status.HTTP_200_OK, response_model=BalanceSummaryRead)
async def read_balance_summary(space_id: uuid.UUID, session: DbSession) -> BalanceSummaryRead:
    """Available (bank and cash), card debt and net of the space, in its currency's minor unit."""
    return await service.get_balance_summary(session, space_id)

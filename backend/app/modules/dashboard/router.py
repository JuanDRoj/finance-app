import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, status

from app.core.db import DbSession
from app.core.errors import ErrorResponse
from app.modules.dashboard import service
from app.modules.dashboard.schemas import DashboardRead
from app.modules.spaces.dependencies import require_space_member

router = APIRouter(
    prefix="/spaces/{space_id}/dashboard",
    tags=["dashboard"],
    dependencies=[Depends(require_space_member)],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)


@router.get("", status_code=status.HTTP_200_OK, response_model=DashboardRead)
async def read_dashboard(space_id: uuid.UUID, session: DbSession) -> DashboardRead:
    """Available, card debt, net and the five main categories where most was spent this month.

    Everything is in the minor unit of the currency of the space. `available_minor`,
    `card_debt_minor` and `net_minor` are the ones of `balance-summary` (all the accounts,
    archived ones included; the debt is positive when the cards are owed). The month is the
    current one in the timezone of the space and is returned as `month` (`YYYY-MM`, what the
    movements list takes as its filter). `top_expense_categories` has up to five main categories,
    largest first, each with its subcategories added in: `amount_minor` (positive) and
    `percentage`, a whole percent of `month_expense_minor` (the total spent in the month, any
    category) rounded to the nearest with the half up. Only confirmed, not deleted expenses
    count: adjustments, transfers, incomes, pending, skipped and deleted movements do not.
    """
    return await service.get_dashboard(session, space_id, now=datetime.now(UTC))

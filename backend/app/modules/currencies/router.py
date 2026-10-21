from fastapi import APIRouter, Depends, status

from app.core.db import DbSession
from app.core.errors import ErrorResponse
from app.modules.auth.dependencies import get_current_user
from app.modules.currencies import service
from app.modules.currencies.schemas import CurrencyRead

# The catalog is the same for everyone, but like the rest of the API it needs a session.
router = APIRouter(
    prefix="/currencies",
    tags=["currencies"],
    dependencies=[Depends(get_current_user)],
    responses={401: {"model": ErrorResponse}},
)


@router.get("", status_code=status.HTTP_200_OK)
async def list_currencies(session: DbSession) -> list[CurrencyRead]:
    """The supported currencies by code, each with its ISO 4217 exponent (the minor unit)."""
    return await service.list_currencies(session)

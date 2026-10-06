import uuid

from fastapi import APIRouter, Depends, status

from app.core.db import DbSession
from app.core.errors import ErrorResponse
from app.modules.auth.dependencies import CurrentUser
from app.modules.spaces import service
from app.modules.spaces.dependencies import require_space_member
from app.modules.spaces.schemas import SpaceRead

router = APIRouter(prefix="/spaces", tags=["spaces"], responses={401: {"model": ErrorResponse}})


@router.get("", status_code=status.HTTP_200_OK)
async def list_spaces(user: CurrentUser, session: DbSession) -> list[SpaceRead]:
    """The spaces where the user is a member."""
    return await service.list_spaces(session, user.id)


# Every route of a single space goes here: the sub-router carries the membership guard.
space_router = APIRouter(
    prefix="/{space_id}",
    dependencies=[Depends(require_space_member)],
    responses={404: {"model": ErrorResponse}},
)


@space_router.get("", status_code=status.HTTP_200_OK)
async def read_space(space_id: uuid.UUID, session: DbSession) -> SpaceRead:
    """A space the user belongs to, with its currency and ISO 4217 exponent."""
    return await service.get_space(session, space_id)


router.include_router(space_router)

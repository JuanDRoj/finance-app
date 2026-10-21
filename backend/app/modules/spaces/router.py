import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import DbSession
from app.core.errors import ErrorResponse
from app.modules.auth.dependencies import CurrentUser
from app.modules.spaces import service
from app.modules.spaces.dependencies import require_space_member
from app.modules.spaces.schemas import SpaceBase, SpaceRead, SpaceUpdate
from app.modules.transactions import service as transactions_service

router = APIRouter(prefix="/spaces", tags=["spaces"], responses={401: {"model": ErrorResponse}})


async def _with_currency_locked(session: AsyncSession, space: SpaceBase) -> SpaceRead:
    """The router composes `spaces` with `transactions` (the owner of the movements).

    The currency of a space is locked once it has any transaction; `spaces` cannot ask (a later
    module), so the router does and adds `currency_locked`.
    """
    locked = await transactions_service.space_has_transactions(session, space.id)
    return SpaceRead(**space.model_dump(), currency_locked=locked)


@router.get("", status_code=status.HTTP_200_OK)
async def list_spaces(user: CurrentUser, session: DbSession) -> list[SpaceRead]:
    """The spaces where the user is a member."""
    spaces = await service.list_spaces(session, user.id)
    return [await _with_currency_locked(session, space) for space in spaces]


# Every route of a single space goes here: the sub-router carries the membership guard.
space_router = APIRouter(
    prefix="/{space_id}",
    dependencies=[Depends(require_space_member)],
    responses={404: {"model": ErrorResponse}},
)


@space_router.get("", status_code=status.HTTP_200_OK)
async def read_space(space_id: uuid.UUID, session: DbSession) -> SpaceRead:
    """A space the user belongs to, with its currency and ISO 4217 exponent."""
    return await _with_currency_locked(session, await service.get_space(session, space_id))


@space_router.patch("", status_code=status.HTTP_200_OK, responses={409: {"model": ErrorResponse}})
async def update_space(space_id: uuid.UUID, data: SpaceUpdate, session: DbSession) -> SpaceRead:
    """Change the currency of the space (409 `space_has_transactions` once it has movements).

    Only while the space has no transactions, deleted ones included; the same currency it already
    has changes nothing. `currency_locked` in the answer tells whether it can still be changed.
    """

    # The movements live in `transactions`: the router brings the question and `spaces.service`
    # applies the rule, asking only after it has locked the space (see `update_space`).
    async def has_transactions() -> bool:
        return await transactions_service.space_has_transactions(session, space_id)

    space = await service.update_space(session, space_id, data, has_transactions=has_transactions)
    return await _with_currency_locked(session, space)


router.include_router(space_router)

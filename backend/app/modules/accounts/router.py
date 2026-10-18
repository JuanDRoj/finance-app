import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.core.db import DbSession
from app.core.errors import ErrorResponse
from app.modules.accounts import service
from app.modules.accounts.models import Account
from app.modules.accounts.schemas import AccountCreate, AccountRead, AccountUpdate
from app.modules.spaces.dependencies import require_space_member

router = APIRouter(
    prefix="/spaces/{space_id}/accounts",
    tags=["accounts"],
    dependencies=[Depends(require_space_member)],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)


@router.get("", status_code=status.HTTP_200_OK, response_model=list[AccountRead])
async def list_accounts(
    space_id: uuid.UUID,
    session: DbSession,
    include_archived: Annotated[bool, Query()] = False,
) -> list[Account]:
    """The accounts of the space by name. The archived ones only with `include_archived`."""
    return await service.list_accounts(session, space_id, include_archived=include_archived)


@router.post("", status_code=status.HTTP_201_CREATED, response_model=AccountRead)
async def create_account(space_id: uuid.UUID, data: AccountCreate, session: DbSession) -> Account:
    """Create a bank, cash or credit card account (the cards need closing and due days)."""
    return await service.create_account(session, space_id, data)


@router.get("/{account_id}", status_code=status.HTTP_200_OK, response_model=AccountRead)
async def read_account(
    space_id: uuid.UUID, account_id: uuid.UUID, session: DbSession
) -> AccountRead:
    """One account of the space, archived or not."""
    return await service.get_account(session, space_id, account_id)


@router.patch("/{account_id}", status_code=status.HTTP_200_OK, response_model=AccountRead)
async def update_account(
    space_id: uuid.UUID, account_id: uuid.UUID, data: AccountUpdate, session: DbSession
) -> Account:
    """Rename an account or change the days of a card. The type cannot be changed."""
    return await service.update_account(session, space_id, account_id, data)

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.core.db import DbSession
from app.core.errors import ErrorResponse
from app.modules.accounts import service
from app.modules.accounts.models import Account
from app.modules.accounts.schemas import (
    AccountCreate,
    AccountRead,
    AccountUpdate,
    AccountWithBalance,
)
from app.modules.spaces.dependencies import require_space_member
from app.modules.transactions import service as transactions_service

router = APIRouter(
    prefix="/spaces/{space_id}/accounts",
    tags=["accounts"],
    dependencies=[Depends(require_space_member)],
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)


def _with_balance(account: Account | AccountRead, balance: int) -> AccountWithBalance:
    """The router composes `accounts` with `transactions` (the owner of the entries)."""
    return AccountWithBalance(
        **AccountRead.model_validate(account).model_dump(), balance_minor=balance
    )


@router.get("", status_code=status.HTTP_200_OK, response_model=list[AccountWithBalance])
async def list_accounts(
    space_id: uuid.UUID,
    session: DbSession,
    include_archived: Annotated[bool, Query()] = False,
) -> list[AccountWithBalance]:
    """The accounts of the space by name, each with its balance. Archived ones only on request."""
    accounts = await service.list_accounts(session, space_id, include_archived=include_archived)
    balances = await transactions_service.get_account_balances(session, space_id)
    return [_with_balance(a, balances.get(a.id, 0)) for a in accounts]


@router.post("", status_code=status.HTTP_201_CREATED, response_model=AccountWithBalance)
async def create_account(
    space_id: uuid.UUID, data: AccountCreate, session: DbSession
) -> AccountWithBalance:
    """Create a bank, cash or credit card account (the cards need closing and due days)."""
    account = await service.create_account(session, space_id, data)
    balance = await transactions_service.get_account_balance(session, space_id, account.id)
    return _with_balance(account, balance)


@router.get("/{account_id}", status_code=status.HTTP_200_OK, response_model=AccountWithBalance)
async def read_account(
    space_id: uuid.UUID, account_id: uuid.UUID, session: DbSession
) -> AccountWithBalance:
    """One account of the space with its balance, archived or not."""
    account = await service.get_account(session, space_id, account_id)
    balance = await transactions_service.get_account_balance(session, space_id, account_id)
    return _with_balance(account, balance)


@router.patch("/{account_id}", status_code=status.HTTP_200_OK, response_model=AccountWithBalance)
async def update_account(
    space_id: uuid.UUID, account_id: uuid.UUID, data: AccountUpdate, session: DbSession
) -> AccountWithBalance:
    """Rename an account or change the days of a card. The type cannot be changed."""
    account = await service.update_account(session, space_id, account_id, data)
    balance = await transactions_service.get_account_balance(session, space_id, account_id)
    return _with_balance(account, balance)

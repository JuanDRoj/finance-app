import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.core.db import DbSession
from app.core.errors import ErrorResponse
from app.modules.accounts import service
from app.modules.accounts.models import Account
from app.modules.accounts.schemas import (
    AccountCreate,
    AccountRead,
    AccountReconcile,
    AccountUpdate,
    AccountWithBalance,
)
from app.modules.spaces.dependencies import SpaceMember, require_space_member
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
    space_id: uuid.UUID, data: AccountCreate, session: DbSession, member: SpaceMember
) -> AccountWithBalance:
    """Create a bank, cash or credit card account (the cards need closing and due days).

    With `initial_balance_minor` (other than 0) the account is born with that balance: an
    adjustment, neither income nor expense, written in the same transaction. On a credit card it is
    the current debt, negative. If the adjustment fails, the account is not created.
    """
    # The router composes `accounts` with `transactions` (the owner of the entries): one request,
    # one database transaction, so the account and its initial balance are all or nothing.
    account = await service.create_account(session, space_id, data)
    if data.initial_balance_minor:  # None and 0 register nothing
        await transactions_service.create_adjustment(
            session,
            space_id,
            member.user_id,
            account.id,
            data.initial_balance_minor,
            now=datetime.now(UTC),
        )
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


@router.post(
    "/{account_id}/reconcile",
    status_code=status.HTTP_200_OK,
    response_model=AccountWithBalance,
    responses={409: {"model": ErrorResponse}},
)
async def reconcile_account(
    space_id: uuid.UUID,
    account_id: uuid.UUID,
    data: AccountReconcile,
    session: DbSession,
    member: SpaceMember,
) -> AccountWithBalance:
    """Match the balance of the account to the real one (what the bank says).

    An adjustment (neither income nor expense) for the difference is registered; if there is none,
    nothing is. `balance_minor` has the sign of the balance of the account: on a credit card,
    negative = you owe. An archived account cannot be reconciled (409).
    """
    await transactions_service.reconcile_account(
        session,
        space_id,
        member.user_id,
        account_id,
        balance_minor=data.balance_minor,
        now=datetime.now(UTC),
    )
    account = await service.get_account(session, space_id, account_id)
    balance = await transactions_service.get_account_balance(session, space_id, account_id)
    return _with_balance(account, balance)


@router.post(
    "/{account_id}/archive",
    status_code=status.HTTP_200_OK,
    response_model=AccountWithBalance,
    responses={409: {"model": ErrorResponse}},
)
async def archive_account(
    space_id: uuid.UUID, account_id: uuid.UUID, session: DbSession
) -> AccountWithBalance:
    """Archive an account whose balance is zero (409 `account_has_balance` otherwise).

    It stops showing in the list and in the selectors; its old movements stay. Archiving an
    archived account changes nothing.
    """

    # The balance lives in `transactions`: the router brings it and `accounts.service` applies the
    # rule, asking for it only after it has locked the account (see `archive_account`).
    async def balance_of() -> int:
        return await transactions_service.get_account_balance(session, space_id, account_id)

    account = await service.archive_account(session, space_id, account_id, balance_of=balance_of)
    return _with_balance(account, await balance_of())


@router.post(
    "/{account_id}/unarchive", status_code=status.HTTP_200_OK, response_model=AccountWithBalance
)
async def unarchive_account(
    space_id: uuid.UUID, account_id: uuid.UUID, session: DbSession
) -> AccountWithBalance:
    """Make an archived account active again, whatever its balance (an active one: no change)."""
    account = await service.unarchive_account(session, space_id, account_id)
    balance = await transactions_service.get_account_balance(session, space_id, account_id)
    return _with_balance(account, balance)

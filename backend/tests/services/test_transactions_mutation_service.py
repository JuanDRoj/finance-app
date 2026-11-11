"""Editing, deleting and restoring a movement (KAN-80), with a real database.

An edit replaces the whole movement (type, date, description and the entries `build_entries`
makes); a delete is `deleted_at`; a restore clears it. Balances, the list and the summary are not
touched by these functions: they already start from the queries that leave out deleted movements,
so the tests read them back to prove the numbers follow.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from pydantic import TypeAdapter
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, InvalidFieldError, NotFoundError
from app.modules.accounts import service as accounts_service
from app.modules.accounts.models import Account
from app.modules.categories import service as categories_service
from app.modules.transactions import service
from app.modules.transactions.models import Entry, Transaction
from app.modules.transactions.schemas import (
    MovementCreate,
    TransactionFilters,
    TransactionListFilters,
)
from tests.transactions_helpers import (
    insert_adjustment,
    insert_expense,
    insert_transaction,
    make_account,
    make_category,
    make_user_and_space,
)

adapter: TypeAdapter[Any] = TypeAdapter(MovementCreate)
DAY = "2026-10-20"
CREATED = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)
LATER = CREATED + timedelta(hours=3)
EVEN_LATER = CREATED + timedelta(days=1)


def _movement(kind: str, **fields: Any) -> MovementCreate:
    data: MovementCreate = adapter.validate_python({"type": kind, "date": DAY, **fields})
    return data


def _expense(account_id: uuid.UUID, category_id: uuid.UUID, **fields: Any) -> MovementCreate:
    return _movement(
        "expense",
        **{"account_id": account_id, "category_id": category_id, "amount_minor": 1550, **fields},
    )


def _income(account_id: uuid.UUID, category_id: uuid.UUID, **fields: Any) -> MovementCreate:
    return _movement(
        "income",
        **{"account_id": account_id, "category_id": category_id, "amount_minor": 9000, **fields},
    )


def _transfer(from_id: uuid.UUID, to_id: uuid.UUID, **fields: Any) -> MovementCreate:
    return _movement(
        "transfer",
        **{"from_account_id": from_id, "to_account_id": to_id, "amount_minor": 3000, **fields},
    )


async def _create(
    session: AsyncSession, space_id: uuid.UUID, user_id: uuid.UUID, data: MovementCreate
) -> uuid.UUID:
    return (await service.create_transaction(session, space_id, user_id, data)).id


async def _balance(session: AsyncSession, space_id: uuid.UUID, account_id: uuid.UUID) -> int:
    return await service.get_account_balance(session, space_id, account_id)


async def _row(session: AsyncSession, transaction_id: uuid.UUID) -> Transaction:
    stmt = (
        select(Transaction)
        .where(Transaction.id == transaction_id)
        .execution_options(populate_existing=True)
    )
    return (await session.scalars(stmt)).one()


async def _entries(session: AsyncSession, transaction_id: uuid.UUID) -> list[tuple[Any, ...]]:
    stmt = (
        select(Entry.account_id, Entry.amount_minor, Entry.category_id)
        .where(Entry.transaction_id == transaction_id)
        .order_by(Entry.id)
    )
    return [tuple(row) for row in await session.execute(stmt)]


async def _count_entries(session: AsyncSession) -> int:
    return await session.scalar(select(func.count()).select_from(Entry)) or 0


async def _snapshot(
    session: AsyncSession, space_id: uuid.UUID, account_id: uuid.UUID
) -> dict[str, Any]:
    """Everything a person reads about the money: list, balance after, summary and balances."""
    everything = await service.list_movements(session, space_id, TransactionListFilters())
    one_account = await service.list_movements(
        session, space_id, TransactionListFilters(account_id=account_id)
    )
    return {
        "list": everything.model_dump(mode="json"),
        "list_of_account": one_account.model_dump(mode="json"),
        "summary": (
            await service.get_movements_summary(session, space_id, TransactionFilters())
        ).model_dump(),
        "balances": await service.get_account_balances(session, space_id),
        "balance_summary": (await service.get_balance_summary(session, space_id)).model_dump(),
    }


async def _archive_directly(
    session: AsyncSession, space_id: uuid.UUID, account_id: uuid.UUID
) -> None:
    """Archive an account skipping the zero-balance rule, to have one with movements."""
    await session.execute(
        update(Account)
        .where(Account.space_id == space_id, Account.id == account_id)
        .values(archived_at=CREATED)
    )
    await session.flush()


# edit: the entries are rebuilt ----------------------------------------------------------------


async def test_editing_an_expense_rebuilds_its_entry_and_the_balance_follows(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    food = await make_category(session, space_id)
    market = await make_category(session, space_id, name="Mercado")
    transaction_id = await _create(session, space_id, user_id, _expense(account.id, food.id))
    assert await _balance(session, space_id, account.id) == -1550

    result = await service.update_transaction(
        session,
        space_id,
        transaction_id,
        _movement(
            "expense",
            date="2026-10-22",
            description="  Súper ",
            account_id=account.id,
            category_id=market.id,
            amount_minor=2300,
        ),
        now=LATER,
    )

    assert result.id == transaction_id
    assert (result.type, result.status, str(result.date), result.description) == (
        "expense",
        "confirmed",
        "2026-10-22",
        "Súper",
    )
    assert result.amount_minor == -2300
    assert result.category is not None
    assert result.category.id == market.id
    assert await _entries(session, transaction_id) == [(account.id, -2300, market.id)]
    assert await _count_entries(session) == 1  # the old entry is gone, not kept next to the new
    assert await _balance(session, space_id, account.id) == -2300


async def test_changing_the_account_gives_the_old_one_its_money_back(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, type_="cash", name="Billetera")
    category = await make_category(session, space_id)
    transaction_id = await _create(session, space_id, user_id, _expense(bank.id, category.id))

    await service.update_transaction(
        session, space_id, transaction_id, _expense(cash.id, category.id), now=LATER
    )

    assert await _balance(session, space_id, bank.id) == 0
    assert await _balance(session, space_id, cash.id) == -1550


async def test_editing_a_card_expense_moves_the_debt(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    visa = await make_account(session, space_id, type_="credit_card", name="Visa")
    category = await make_category(session, space_id)
    transaction_id = await _create(
        session, space_id, user_id, _expense(visa.id, category.id, description="Cena")
    )

    await service.update_transaction(
        session,
        space_id,
        transaction_id,
        _movement(
            "expense", account_id=visa.id, category_id=category.id, amount_minor=4000, date=DAY
        ),
        now=LATER,
    )

    summary = await service.get_balance_summary(session, space_id)
    assert await _balance(session, space_id, visa.id) == -4000
    assert (summary.available_minor, summary.card_debt_minor, summary.net_minor) == (0, 4000, -4000)


async def test_an_expense_becomes_an_income_and_the_sign_flips(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    food = await make_category(session, space_id)
    salary = await make_category(session, space_id, kind="income", name="Sueldo")
    transaction_id = await _create(session, space_id, user_id, _expense(account.id, food.id))

    result = await service.update_transaction(
        session, space_id, transaction_id, _income(account.id, salary.id), now=LATER
    )

    assert result.type == "income"
    assert await _entries(session, transaction_id) == [(account.id, 9000, salary.id)]
    assert await _balance(session, space_id, account.id) == 9000


async def test_the_new_type_needs_a_category_of_its_kind(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    food = await make_category(session, space_id)
    transaction_id = await _create(session, space_id, user_id, _expense(account.id, food.id))

    with pytest.raises(InvalidFieldError) as error:
        await service.update_transaction(
            session, space_id, transaction_id, _income(account.id, food.id), now=LATER
        )

    assert error.value.code == "transaction_category_kind_mismatch"
    assert error.value.loc == ["body", "income", "category_id"]  # the loc names the NEW type


async def test_an_expense_becomes_a_transfer_and_back(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, type_="cash", name="Billetera")
    category = await make_category(session, space_id)
    transaction_id = await _create(session, space_id, user_id, _expense(bank.id, category.id))

    as_transfer = await service.update_transaction(
        session, space_id, transaction_id, _transfer(bank.id, cash.id), now=LATER
    )

    assert as_transfer.type == "transfer"
    assert await _entries(session, transaction_id) == [
        (bank.id, -3000, None),
        (cash.id, 3000, None),
    ]
    assert await _count_entries(session) == 2
    assert (
        await _balance(session, space_id, bank.id),
        await _balance(session, space_id, cash.id),
    ) == (
        -3000,
        3000,
    )

    back = await service.update_transaction(
        session, space_id, transaction_id, _expense(bank.id, category.id), now=EVEN_LATER
    )

    assert back.type == "expense"
    assert await _entries(session, transaction_id) == [(bank.id, -1550, category.id)]
    assert await _count_entries(session) == 1
    assert await _balance(session, space_id, cash.id) == 0


async def test_a_transfer_edit_can_swap_its_destination(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, type_="cash", name="Billetera")
    savings = await make_account(session, space_id, name="Ahorro")
    transaction_id = await _create(session, space_id, user_id, _transfer(bank.id, cash.id))

    await service.update_transaction(
        session, space_id, transaction_id, _transfer(bank.id, savings.id), now=LATER
    )

    assert await _balance(session, space_id, cash.id) == 0
    assert await _balance(session, space_id, savings.id) == 3000
    assert await _balance(session, space_id, bank.id) == -3000


async def test_omitting_the_description_clears_the_note(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    transaction_id = await _create(
        session, space_id, user_id, _expense(account.id, category.id, description="Café")
    )

    result = await service.update_transaction(
        session, space_id, transaction_id, _expense(account.id, category.id), now=LATER
    )

    assert result.description is None
    assert (await _row(session, transaction_id)).description is None


async def test_an_edit_keeps_the_identity_and_touches_updated_at(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    transaction_id = await _create(session, space_id, user_id, _expense(account.id, category.id))
    before = await _row(session, transaction_id)
    created_at = before.created_at

    await service.update_transaction(
        session,
        space_id,
        transaction_id,
        _expense(account.id, category.id, description="Otro"),
        now=LATER,
    )

    after = await _row(session, transaction_id)
    assert (after.id, after.space_id, after.created_by, after.status) == (
        transaction_id,
        space_id,
        user_id,
        "confirmed",
    )
    assert after.created_at == created_at
    assert after.updated_at == LATER
    assert after.deleted_at is None


async def test_an_amount_only_edit_also_touches_updated_at(session: AsyncSession) -> None:
    # Only the entries change here, so no column of the transaction would trigger `onupdate`.
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    transaction_id = await _create(session, space_id, user_id, _expense(account.id, category.id))

    await service.update_transaction(
        session,
        space_id,
        transaction_id,
        _movement(
            "expense", account_id=account.id, category_id=category.id, amount_minor=1, date=DAY
        ),
        now=LATER,
    )

    assert (await _row(session, transaction_id)).updated_at == LATER


# edit: what is refused ------------------------------------------------------------------------


async def _refused(
    session: AsyncSession, space_id: uuid.UUID, transaction_id: uuid.UUID, data: MovementCreate
) -> InvalidFieldError:
    with pytest.raises(InvalidFieldError) as error:
        await service.update_transaction(session, space_id, transaction_id, data, now=LATER)
    return error.value


async def test_an_account_that_does_not_exist_is_a_422_on_its_field(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    transaction_id = await _create(session, space_id, user_id, _expense(account.id, category.id))

    error = await _refused(session, space_id, transaction_id, _expense(uuid.uuid4(), category.id))

    assert (error.code, error.loc) == ("account_not_found", ["body", "expense", "account_id"])


async def test_an_account_of_another_space_answers_like_a_missing_one(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _, other_space = await make_user_and_space(session, "uid-b")
    account = await make_account(session, space_id)
    foreign = await make_account(session, other_space)
    category = await make_category(session, space_id)
    transaction_id = await _create(session, space_id, user_id, _expense(account.id, category.id))

    foreign_error = await _refused(
        session, space_id, transaction_id, _expense(foreign.id, category.id)
    )
    missing_error = await _refused(
        session, space_id, transaction_id, _expense(uuid.uuid4(), category.id)
    )

    assert (foreign_error.code, foreign_error.loc) == (missing_error.code, missing_error.loc)


async def test_the_destination_of_a_transfer_edit_must_exist_and_be_active(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, type_="cash", name="Billetera")
    old = await make_account(session, space_id, name="Viejo", archived=True)
    transaction_id = await _create(session, space_id, user_id, _transfer(bank.id, cash.id))

    error = await _refused(session, space_id, transaction_id, _transfer(bank.id, old.id))

    assert (error.code, error.loc) == ("account_archived", ["body", "transfer", "to_account_id"])


async def test_an_archived_account_in_the_body_is_refused_even_if_the_movement_already_had_it(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    transaction_id = await _create(session, space_id, user_id, _expense(account.id, category.id))
    await _archive_directly(session, space_id, account.id)

    error = await _refused(
        session, space_id, transaction_id, _expense(account.id, category.id, description="Nota")
    )

    assert (error.code, error.loc) == ("account_archived", ["body", "expense", "account_id"])


async def test_moving_a_movement_out_of_an_archived_account_is_a_409(
    session: AsyncSession,
) -> None:
    # The archived account is not in the body, only in the stored entries: its balance would change.
    user_id, space_id = await make_user_and_space(session, "uid-a")
    old = await make_account(session, space_id, name="Viejo")
    bank = await make_account(session, space_id)
    category = await make_category(session, space_id)
    transaction_id = await _create(session, space_id, user_id, _expense(old.id, category.id))
    await _archive_directly(session, space_id, old.id)

    with pytest.raises(ConflictError) as error:
        await service.update_transaction(
            session, space_id, transaction_id, _expense(bank.id, category.id), now=LATER
        )

    assert error.value.code == "account_archived"
    assert await _entries(session, transaction_id) == [(old.id, -1550, category.id)]
    assert await _balance(session, space_id, bank.id) == 0


@pytest.mark.parametrize("which", ["missing", "foreign", "wrong_kind", "archived"])
async def test_a_bad_category_is_a_422_on_its_field(session: AsyncSession, which: str) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _, other_space = await make_user_and_space(session, "uid-b")
    account = await make_account(session, space_id)
    food = await make_category(session, space_id)
    category_ids = {
        "missing": uuid.uuid4(),
        "foreign": (await make_category(session, other_space)).id,
        "wrong_kind": (await make_category(session, space_id, kind="income", name="Sueldo")).id,
        "archived": (await make_category(session, space_id, name="Viejo", archived=True)).id,
    }
    expected = {
        "missing": "category_not_found",
        "foreign": "category_not_found",
        "wrong_kind": "transaction_category_kind_mismatch",
        "archived": "category_archived",
    }
    transaction_id = await _create(session, space_id, user_id, _expense(account.id, food.id))

    error = await _refused(
        session, space_id, transaction_id, _expense(account.id, category_ids[which])
    )

    assert (error.code, error.loc) == (expected[which], ["body", "expense", "category_id"])
    assert await _entries(session, transaction_id) == [(account.id, -1550, food.id)]


async def test_the_archived_category_a_movement_already_has_can_stay(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    transaction_id = await _create(session, space_id, user_id, _expense(account.id, category.id))

    await categories_service.archive_category(session, space_id, category.id)

    result = await service.update_transaction(
        session,
        space_id,
        transaction_id,
        _expense(account.id, category.id, description="Solo la nota"),
        now=LATER,
    )

    assert result.description == "Solo la nota"
    assert result.category is not None
    assert result.category.id == category.id


async def test_an_edit_that_fails_leaves_the_movement_as_it_was(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    transaction_id = await _create(
        session, space_id, user_id, _expense(account.id, category.id, description="Café")
    )
    before = await service.get_movement(session, space_id, transaction_id)

    await _refused(session, space_id, transaction_id, _expense(uuid.uuid4(), category.id))

    assert await service.get_movement(session, space_id, transaction_id) == before
    assert await _count_entries(session) == 1


@pytest.mark.parametrize(
    ("kind", "status"),
    [("adjustment", "confirmed"), ("expense", "pending"), ("income", "skipped")],
)
async def test_only_confirmed_expenses_incomes_and_transfers_can_be_edited(
    session: AsyncSession, kind: str, status: str
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    stored = await insert_transaction(
        session,
        space_id,
        user_id,
        entries=[(account.id, 100, None)],
        type_=kind,
        status=status,
    )

    with pytest.raises(ConflictError) as error:
        await service.update_transaction(
            session, space_id, stored.id, _expense(account.id, category.id), now=LATER
        )

    assert error.value.code == "transaction_not_editable"
    assert await _entries(session, stored.id) == [(account.id, 100, None)]


async def test_editing_a_movement_that_does_not_exist_or_is_of_another_space_is_a_404(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    other_user, other_space = await make_user_and_space(session, "uid-b")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    other_account = await make_account(session, other_space)
    other_category = await make_category(session, other_space)
    theirs = await _create(
        session, other_space, other_user, _expense(other_account.id, other_category.id)
    )

    codes = []
    for transaction_id in (uuid.uuid4(), theirs):
        with pytest.raises(NotFoundError) as error:
            await service.update_transaction(
                session, space_id, transaction_id, _expense(account.id, category.id), now=LATER
            )
        codes.append((error.value.code, error.value.detail))

    assert codes == [("transaction_not_found", "Transaction not found")] * 2
    assert await _entries(session, theirs) == [(other_account.id, -1550, other_category.id)]
    assert user_id != other_user


async def test_a_deleted_movement_cannot_be_edited(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    transaction_id = await _create(session, space_id, user_id, _expense(account.id, category.id))
    await service.delete_transaction(session, space_id, transaction_id, now=LATER)

    with pytest.raises(NotFoundError) as error:
        await service.update_transaction(
            session, space_id, transaction_id, _expense(account.id, category.id), now=EVEN_LATER
        )

    assert error.value.code == "transaction_not_found"


# delete ---------------------------------------------------------------------------------------


async def test_deleting_marks_the_movement_and_keeps_its_entries(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    transaction_id = await _create(session, space_id, user_id, _expense(account.id, category.id))

    await service.delete_transaction(session, space_id, transaction_id, now=LATER)

    row = await _row(session, transaction_id)
    assert (row.deleted_at, row.updated_at) == (LATER, LATER)
    assert await _entries(session, transaction_id) == [(account.id, -1550, category.id)]


async def test_a_deleted_movement_counts_nowhere_and_comes_back_identical(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, type_="cash", name="Billetera")
    food = await make_category(session, space_id)
    salary = await make_category(session, space_id, kind="income", name="Sueldo")
    await _create(session, space_id, user_id, _income(bank.id, salary.id))
    target = await _create(
        session, space_id, user_id, _expense(bank.id, food.id, description="Café")
    )
    await _create(session, space_id, user_id, _transfer(bank.id, cash.id, date="2026-10-21"))
    before = await _snapshot(session, space_id, bank.id)

    await service.delete_transaction(session, space_id, target, now=LATER)

    during = await _snapshot(session, space_id, bank.id)
    assert during["balances"][bank.id] == 9000 - 3000  # the expense of 1550 no longer counts
    assert during["summary"] == {
        "count": 2,
        "income_minor": 9000,
        "expense_minor": 0,
        "remaining_minor": 9000,
        "balance_change_minor": None,
    }
    assert target not in [uuid.UUID(item["id"]) for item in during["list"]["items"]]
    assert target not in [uuid.UUID(item["id"]) for item in during["list_of_account"]["items"]]
    assert during["balance_summary"]["net_minor"] == 9000
    with pytest.raises(NotFoundError):
        await service.get_movement(session, space_id, target)

    restored = await service.restore_transaction(session, space_id, target, now=EVEN_LATER)

    assert restored.id == target
    assert await _snapshot(session, space_id, bank.id) == before


async def test_deleting_a_transfer_gives_both_accounts_their_balance_back(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    visa = await make_account(session, space_id, type_="credit_card", name="Visa")
    category = await make_category(session, space_id)
    await _create(session, space_id, user_id, _expense(visa.id, category.id))  # the card owes 1550
    paying = await _create(
        session, space_id, user_id, _transfer(bank.id, visa.id, amount_minor=1550)
    )

    await service.delete_transaction(session, space_id, paying, now=LATER)

    assert await _balance(session, space_id, bank.id) == 0
    assert await _balance(session, space_id, visa.id) == -1550


async def test_deleting_leaves_the_currency_of_the_space_locked(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    transaction_id = await _create(session, space_id, user_id, _expense(account.id, category.id))

    await service.delete_transaction(session, space_id, transaction_id, now=LATER)

    assert await service.space_has_transactions(session, space_id) is True


async def test_deleting_twice_keeps_the_first_deleted_at(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    transaction_id = await _create(session, space_id, user_id, _expense(account.id, category.id))
    await service.delete_transaction(session, space_id, transaction_id, now=LATER)

    await service.delete_transaction(session, space_id, transaction_id, now=EVEN_LATER)

    row = await _row(session, transaction_id)
    assert (row.deleted_at, row.updated_at) == (LATER, LATER)


async def test_deleting_a_movement_that_does_not_exist_or_is_of_another_space_is_a_404(
    session: AsyncSession,
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    other_user, other_space = await make_user_and_space(session, "uid-b")
    other_account = await make_account(session, other_space)
    other_category = await make_category(session, other_space)
    theirs = await _create(
        session, other_space, other_user, _expense(other_account.id, other_category.id)
    )

    for transaction_id in (uuid.uuid4(), theirs):
        with pytest.raises(NotFoundError) as error:
            await service.delete_transaction(session, space_id, transaction_id, now=LATER)
        assert error.value.code == "transaction_not_found"

    assert (await _row(session, theirs)).deleted_at is None


@pytest.mark.parametrize(
    ("kind", "status"),
    [("adjustment", "confirmed"), ("expense", "pending"), ("transfer", "skipped")],
)
async def test_only_confirmed_expenses_incomes_and_transfers_can_be_deleted(
    session: AsyncSession, kind: str, status: str
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    stored = await insert_transaction(
        session, space_id, user_id, entries=[(account.id, 100, None)], type_=kind, status=status
    )

    with pytest.raises(ConflictError) as error:
        await service.delete_transaction(session, space_id, stored.id, now=LATER)

    assert error.value.code == "transaction_not_editable"
    assert (await _row(session, stored.id)).deleted_at is None


async def test_deleting_a_movement_of_an_archived_account_is_a_409(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    transaction_id = await _create(session, space_id, user_id, _expense(account.id, category.id))
    await _archive_directly(session, space_id, account.id)

    with pytest.raises(ConflictError) as error:
        await service.delete_transaction(session, space_id, transaction_id, now=LATER)

    assert error.value.code == "account_archived"
    assert (await _row(session, transaction_id)).deleted_at is None


# restore --------------------------------------------------------------------------------------


async def test_restoring_clears_deleted_at_and_touches_updated_at(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    transaction_id = await _create(
        session, space_id, user_id, _expense(account.id, category.id, description="Café")
    )
    await service.delete_transaction(session, space_id, transaction_id, now=LATER)

    restored = await service.restore_transaction(session, space_id, transaction_id, now=EVEN_LATER)

    row = await _row(session, transaction_id)
    assert (row.deleted_at, row.updated_at) == (None, EVEN_LATER)
    assert (restored.id, restored.description, restored.amount_minor) == (
        transaction_id,
        "Café",
        -1550,
    )
    assert await _balance(session, space_id, account.id) == -1550


async def test_restoring_a_movement_that_is_not_deleted_changes_nothing(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    transaction_id = await _create(session, space_id, user_id, _expense(account.id, category.id))
    before = await _row(session, transaction_id)
    updated_at = before.updated_at

    result = await service.restore_transaction(session, space_id, transaction_id, now=LATER)

    assert result == await service.get_movement(session, space_id, transaction_id)
    assert (await _row(session, transaction_id)).updated_at == updated_at


async def test_an_edit_after_a_restore_works(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    transaction_id = await _create(session, space_id, user_id, _expense(account.id, category.id))
    await service.delete_transaction(session, space_id, transaction_id, now=LATER)
    await service.restore_transaction(session, space_id, transaction_id, now=LATER)

    await service.update_transaction(
        session,
        space_id,
        transaction_id,
        _movement(
            "expense", account_id=account.id, category_id=category.id, amount_minor=700, date=DAY
        ),
        now=EVEN_LATER,
    )

    assert await _balance(session, space_id, account.id) == -700


async def test_restoring_onto_an_account_archived_meanwhile_is_a_409_until_it_is_unarchived(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    transaction_id = await _create(session, space_id, user_id, _expense(account.id, category.id))
    await service.delete_transaction(session, space_id, transaction_id, now=LATER)

    async def balance_of() -> int:
        return await service.get_account_balance(session, space_id, account.id)

    # With the movement deleted the balance is 0, so the real archive rule lets it through.
    await accounts_service.archive_account(session, space_id, account.id, balance_of=balance_of)

    with pytest.raises(ConflictError) as error:
        await service.restore_transaction(session, space_id, transaction_id, now=EVEN_LATER)

    assert error.value.code == "account_archived"
    assert (await _row(session, transaction_id)).deleted_at == LATER
    await accounts_service.unarchive_account(session, space_id, account.id)

    await service.restore_transaction(session, space_id, transaction_id, now=EVEN_LATER)

    assert await _balance(session, space_id, account.id) == -1550


async def test_restoring_a_movement_that_does_not_exist_or_is_of_another_space_is_a_404(
    session: AsyncSession,
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    other_user, other_space = await make_user_and_space(session, "uid-b")
    other_account = await make_account(session, other_space)
    other_category = await make_category(session, other_space)
    theirs = await _create(
        session, other_space, other_user, _expense(other_account.id, other_category.id)
    )
    await service.delete_transaction(session, other_space, theirs, now=LATER)

    for transaction_id in (uuid.uuid4(), theirs):
        with pytest.raises(NotFoundError) as error:
            await service.restore_transaction(session, space_id, transaction_id, now=EVEN_LATER)
        assert error.value.code == "transaction_not_found"

    assert (await _row(session, theirs)).deleted_at == LATER


async def test_an_adjustment_that_is_deleted_cannot_be_restored_through_the_api_rules(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    stored = await insert_adjustment(
        session, space_id, user_id, account.id, 500, deleted_at=CREATED
    )

    with pytest.raises(ConflictError) as error:
        await service.restore_transaction(session, space_id, stored.id, now=LATER)

    assert error.value.code == "transaction_not_editable"
    assert (await _row(session, stored.id)).deleted_at == CREATED


async def test_other_movements_are_not_touched_by_an_edit_a_delete_or_a_restore(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    other = await insert_expense(session, space_id, user_id, account.id, category.id, 400)
    target = await _create(session, space_id, user_id, _expense(account.id, category.id))

    await service.update_transaction(
        session, space_id, target, _expense(account.id, category.id, description="x"), now=LATER
    )
    await service.delete_transaction(session, space_id, target, now=LATER)
    await service.restore_transaction(session, space_id, target, now=EVEN_LATER)

    assert await _entries(session, other.id) == [(account.id, -400, category.id)]
    assert (await _row(session, other.id)).deleted_at is None

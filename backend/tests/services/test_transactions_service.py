import uuid
from datetime import UTC, date, datetime
from typing import Any

import pytest
from pydantic import TypeAdapter
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import ConflictError, InvalidFieldError, NotFoundError
from app.modules.categories import service as categories_service
from app.modules.transactions import service
from app.modules.transactions.models import Entry, Transaction
from app.modules.transactions.schemas import (
    BalanceSummaryRead,
    TransactionCreate,
    TransactionRead,
)
from tests.transactions_helpers import (
    insert_transaction,
    make_account,
    make_category,
    make_user_and_space,
)

adapter: TypeAdapter[Any] = TypeAdapter(TransactionCreate)
DAY = "2026-10-20"
NOW = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)
MAX_SAFE = 2**53 - 1


def _data(kind: str, **fields: Any) -> TransactionCreate:
    data: TransactionCreate = adapter.validate_python({"type": kind, "date": DAY, **fields})
    return data


def _body(**fields: object) -> dict[str, object]:
    return {"type": "adjustment", "date": DAY, **fields}


async def _counts(session: AsyncSession) -> tuple[int, int]:
    transactions = await session.scalar(select(func.count()).select_from(Transaction))
    entries = await session.scalar(select(func.count()).select_from(Entry))
    return transactions or 0, entries or 0


# balance of an account ------------------------------------------------------------------------


async def test_the_balance_of_an_account_is_the_sum_of_its_confirmed_entries(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    for amount in (10_000, -2_500, 1_050):
        await insert_transaction(
            session, space_id=space_id, user_id=user_id, entries=[(account.id, amount, None)]
        )

    balance = await service.get_account_balance(session, space_id, account.id)

    assert balance == 8_550
    assert type(balance) is int  # SUM(bigint) is numeric in PostgreSQL: never leak a Decimal


async def test_an_account_without_entries_has_a_zero_balance(session: AsyncSession) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)

    assert await service.get_account_balance(session, space_id, account.id) == 0
    assert await service.get_account_balances(session, space_id) == {}


@pytest.mark.parametrize("status", ["pending", "skipped"])
async def test_pending_and_skipped_transactions_do_not_count(
    session: AsyncSession, status: str
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    await insert_transaction(
        session, space_id=space_id, user_id=user_id, entries=[(account.id, 5_000, None)]
    )
    await insert_transaction(
        session,
        space_id=space_id,
        user_id=user_id,
        entries=[(account.id, 9_999, None)],
        status=status,
    )

    assert await service.get_account_balance(session, space_id, account.id) == 5_000
    assert await service.get_account_balances(session, space_id) == {account.id: 5_000}


async def test_deleted_transactions_do_not_count(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    await insert_transaction(
        session, space_id=space_id, user_id=user_id, entries=[(account.id, 5_000, None)]
    )
    await insert_transaction(
        session,
        space_id=space_id,
        user_id=user_id,
        entries=[(account.id, -3_000, None)],
        deleted_at=NOW,
    )

    assert await service.get_account_balance(session, space_id, account.id) == 5_000


async def test_a_deleted_or_pending_movement_is_ignored_while_the_confirmed_ones_count(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    other = await make_account(session, space_id, name="Efectivo", type_="cash")
    spec = (space_id, user_id)
    await insert_transaction(session, *spec, entries=[(account.id, 1_000, None)])
    await insert_transaction(session, *spec, entries=[(account.id, 200, None)], status="pending")
    await insert_transaction(session, *spec, entries=[(account.id, 30, None)], deleted_at=NOW)
    await insert_transaction(
        session, *spec, entries=[(account.id, 4, None)], status="pending", deleted_at=NOW
    )
    await insert_transaction(session, *spec, entries=[(other.id, -50, None)])

    assert await service.get_account_balances(session, space_id) == {
        account.id: 1_000,
        other.id: -50,
    }


async def test_a_transfer_moves_the_balance_and_adds_up_to_zero(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    await insert_transaction(
        session, space_id=space_id, user_id=user_id, entries=[(bank.id, 10_000, None)]
    )
    await insert_transaction(
        session,
        space_id=space_id,
        user_id=user_id,
        type_="transfer",
        entries=[(bank.id, -3_000, None), (card.id, 3_000, None)],
    )

    balances = await service.get_account_balances(session, space_id)

    assert balances == {bank.id: 7_000, card.id: 3_000}


async def test_a_credit_card_balance_is_negative_when_you_owe(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    category = await make_category(session, space_id)
    await insert_transaction(
        session,
        space_id=space_id,
        user_id=user_id,
        type_="expense",
        entries=[(card.id, -4_500, category.id)],
    )

    assert await service.get_account_balance(session, space_id, card.id) == -4_500


async def test_balances_of_two_spaces_are_independent(session: AsyncSession) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    user_b, space_b = await make_user_and_space(session, "uid-b")
    account_a = await make_account(session, space_a)
    account_b = await make_account(session, space_b)
    await insert_transaction(
        session, space_id=space_a, user_id=user_a, entries=[(account_a.id, 7_000, None)]
    )
    await insert_transaction(
        session, space_id=space_b, user_id=user_b, entries=[(account_b.id, 1_000, None)]
    )

    assert await service.get_account_balances(session, space_a) == {account_a.id: 7_000}
    assert await service.get_account_balances(session, space_b) == {account_b.id: 1_000}


async def test_the_balance_of_an_account_of_another_space_is_zero(session: AsyncSession) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    _, space_b = await make_user_and_space(session, "uid-b")
    account_a = await make_account(session, space_a)
    await insert_transaction(
        session, space_id=space_a, user_id=user_a, entries=[(account_a.id, 7_000, None)]
    )

    assert await service.get_account_balance(session, space_b, account_a.id) == 0


# summary ------------------------------------------------------------------------------------


async def test_the_summary_of_an_empty_space_is_all_zeros(session: AsyncSession) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")

    summary = await service.get_balance_summary(session, space_id)

    assert summary == BalanceSummaryRead(available_minor=0, card_debt_minor=0, net_minor=0)


async def test_the_summary_splits_available_money_from_card_debt(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, type_="cash", name="Billetera")
    visa = await make_account(session, space_id, type_="credit_card", name="Visa")
    amex = await make_account(session, space_id, type_="credit_card", name="Amex")
    spec = (space_id, user_id)
    await insert_transaction(session, *spec, entries=[(bank.id, 100_000, None)])
    await insert_transaction(session, *spec, entries=[(cash.id, 2_500, None)])
    await insert_transaction(session, *spec, entries=[(visa.id, -30_000, None)])
    await insert_transaction(session, *spec, entries=[(amex.id, -1_250, None)])

    summary = await service.get_balance_summary(session, space_id)

    assert summary.available_minor == 102_500
    assert summary.card_debt_minor == 31_250  # positive = you owe
    assert summary.net_minor == 71_250


async def test_the_summary_ignores_pending_skipped_and_deleted_movements(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    spec = (space_id, user_id)
    await insert_transaction(session, *spec, entries=[(bank.id, 1_000, None)])
    await insert_transaction(session, *spec, entries=[(bank.id, 7, None)], status="pending")
    await insert_transaction(session, *spec, entries=[(bank.id, 70, None)], status="skipped")
    await insert_transaction(session, *spec, entries=[(card.id, -500, None)], deleted_at=NOW)

    summary = await service.get_balance_summary(session, space_id)

    assert (summary.available_minor, summary.card_debt_minor, summary.net_minor) == (
        1_000,
        0,
        1_000,
    )


async def test_a_card_paid_in_excess_gives_a_negative_debt_that_is_not_clamped(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    spec = (space_id, user_id)
    await insert_transaction(session, *spec, entries=[(bank.id, 10_000, None)])
    await insert_transaction(session, *spec, entries=[(card.id, 300, None)])

    summary = await service.get_balance_summary(session, space_id)

    assert summary.card_debt_minor == -300
    assert summary.net_minor == 10_300 == summary.available_minor - summary.card_debt_minor


async def test_a_transfer_does_not_change_the_net(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    spec = (space_id, user_id)
    await insert_transaction(session, *spec, entries=[(bank.id, 10_000, None)])
    await insert_transaction(session, *spec, entries=[(card.id, -4_000, None)])
    before = await service.get_balance_summary(session, space_id)

    await insert_transaction(
        session,
        *spec,
        type_="transfer",
        entries=[(bank.id, -4_000, None), (card.id, 4_000, None)],
    )
    after = await service.get_balance_summary(session, space_id)

    assert (before.available_minor, before.card_debt_minor) == (10_000, 4_000)
    assert (after.available_minor, after.card_debt_minor) == (6_000, 0)
    assert after.net_minor == before.net_minor == 6_000


async def test_the_summary_counts_archived_accounts(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    old = await make_account(session, space_id, archived=True)
    await insert_transaction(
        session, space_id=space_id, user_id=user_id, entries=[(old.id, 800, None)]
    )

    summary = await service.get_balance_summary(session, space_id)

    assert summary.available_minor == 800


async def test_the_summary_of_a_space_ignores_the_movements_of_another(
    session: AsyncSession,
) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    _, space_b = await make_user_and_space(session, "uid-b")
    account = await make_account(session, space_a)
    await insert_transaction(
        session, space_id=space_a, user_id=user_a, entries=[(account.id, 9_000, None)]
    )

    assert (await service.get_balance_summary(session, space_b)).net_minor == 0
    assert (await service.get_balance_summary(session, space_a)).net_minor == 9_000


# create_transaction: the four types ---------------------------------------------------------


async def test_create_an_expense(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)

    result = await service.create_transaction(
        session,
        space_id,
        user_id,
        _data(
            "expense",
            account_id=str(account.id),
            category_id=str(category.id),
            amount_minor=1550,
            description=" Súper ",
        ),
    )

    assert isinstance(result, TransactionRead)
    assert result.id.version == 7
    assert (result.type, result.status, result.date) == ("expense", "confirmed", date(2026, 10, 20))
    assert result.description == "Súper"
    assert [(e.account_id, e.amount_minor, e.category_id) for e in result.entries] == [
        (account.id, -1550, category.id)
    ]
    stored = await session.scalar(select(Transaction).where(Transaction.id == result.id))
    assert stored is not None
    assert (stored.space_id, stored.created_by, stored.deleted_at) == (space_id, user_id, None)
    assert await service.get_account_balance(session, space_id, account.id) == -1550


async def test_create_an_income(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id, kind="income", name="Sueldo")

    result = await service.create_transaction(
        session,
        space_id,
        user_id,
        _data(
            "income", account_id=str(account.id), category_id=str(category.id), amount_minor=90_000
        ),
    )

    assert result.type == "income"
    assert [(e.amount_minor, e.category_id) for e in result.entries] == [(90_000, category.id)]
    assert result.description is None
    assert await service.get_account_balance(session, space_id, account.id) == 90_000


async def test_create_a_transfer_adds_up_to_zero_and_moves_the_balances(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    await service.create_transaction(
        session,
        space_id,
        user_id,
        _data("adjustment", account_id=str(bank.id), amount_minor=10_000),
    )

    result = await service.create_transaction(
        session,
        space_id,
        user_id,
        _data(
            "transfer",
            from_account_id=str(bank.id),
            to_account_id=str(card.id),
            amount_minor=3_000,
        ),
    )

    assert [(e.account_id, e.amount_minor, e.category_id) for e in result.entries] == [
        (bank.id, -3_000, None),
        (card.id, 3_000, None),
    ]
    assert sum(e.amount_minor for e in result.entries) == 0
    assert await service.get_account_balances(session, space_id) == {bank.id: 7_000, card.id: 3_000}


@pytest.mark.parametrize("amount", [2_500, -2_500])
async def test_create_an_adjustment_has_no_category_and_keeps_its_sign(
    session: AsyncSession, amount: int
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)

    result = await service.create_transaction(
        session,
        space_id,
        user_id,
        _data("adjustment", account_id=str(account.id), amount_minor=amount),
    )

    assert result.type == "adjustment"
    assert [(e.amount_minor, e.category_id) for e in result.entries] == [(amount, None)]
    assert await service.get_account_balance(session, space_id, account.id) == amount


async def test_a_created_transaction_stores_the_space_on_each_entry(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, type_="cash", name="Billetera")

    await service.create_transaction(
        session,
        space_id,
        user_id,
        _data(
            "transfer", from_account_id=str(bank.id), to_account_id=str(cash.id), amount_minor=10
        ),
    )

    assert set(await session.scalars(select(Entry.space_id))) == {space_id}


async def test_the_entries_read_back_in_the_order_they_were_built(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    bank = await make_account(session, space_id)
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    created = await service.create_transaction(
        session,
        space_id,
        user_id,
        _data(
            "transfer", from_account_id=str(bank.id), to_account_id=str(card.id), amount_minor=700
        ),
    )
    session.expunge_all()  # read it back from the database, not from the identity map

    stored = await session.scalar(
        select(Transaction)
        .where(Transaction.id == created.id)
        .options(selectinload(Transaction.entries))
    )

    assert stored is not None
    assert [(e.account_id, e.amount_minor) for e in stored.entries] == [
        (bank.id, -700),
        (card.id, 700),
    ]


async def test_a_movement_may_go_to_a_main_category_that_has_subcategories(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    main = await make_category(session, space_id, name="Comida")
    sub = await make_category(session, space_id, name="Supermercado", parent_id=main.id)

    for category in (main, sub):
        result = await service.create_transaction(
            session,
            space_id,
            user_id,
            _data(
                "expense",
                account_id=str(account.id),
                category_id=str(category.id),
                amount_minor=100,
            ),
        )
        assert result.entries[0].category_id == category.id


async def test_there_is_no_restriction_by_account_type(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    cash = await make_account(session, space_id, type_="cash", name="Billetera")
    income = await make_category(session, space_id, kind="income", name="Reembolso")

    refund = await service.create_transaction(
        session,
        space_id,
        user_id,
        _data("income", account_id=str(card.id), category_id=str(income.id), amount_minor=500),
    )
    advance = await service.create_transaction(
        session,
        space_id,
        user_id,
        _data(
            "transfer", from_account_id=str(card.id), to_account_id=str(cash.id), amount_minor=900
        ),
    )

    assert refund.entries[0].amount_minor == 500
    assert [e.amount_minor for e in advance.entries] == [-900, 900]


# create_transaction: references ---------------------------------------------------------------


async def _reject(
    session: AsyncSession, space_id: uuid.UUID, user_id: uuid.UUID, data: TransactionCreate
) -> InvalidFieldError:
    before = await _counts(session)
    with pytest.raises(InvalidFieldError) as exc:
        await service.create_transaction(session, space_id, user_id, data)
    assert await _counts(session) == before  # a refused movement leaves nothing behind
    return exc.value


@pytest.mark.parametrize("kind", ["expense", "income", "adjustment"])
async def test_an_account_of_another_space_is_refused(session: AsyncSession, kind: str) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    _, space_b = await make_user_and_space(session, "uid-b")
    theirs = await make_account(session, space_b)
    category = await make_category(
        session, space_a, kind="income" if kind == "income" else "expense"
    )
    extra = {} if kind == "adjustment" else {"category_id": str(category.id)}

    error = await _reject(
        session,
        space_a,
        user_a,
        _data(kind, account_id=str(theirs.id), amount_minor=100, **extra),
    )

    assert (error.code, error.loc) == ("account_not_found", ["body", "account_id"])


async def test_a_missing_account_is_refused(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")

    error = await _reject(
        session,
        space_id,
        user_id,
        _data("adjustment", account_id=str(uuid.uuid4()), amount_minor=100),
    )

    assert (error.code, error.loc) == ("account_not_found", ["body", "account_id"])


async def test_an_archived_account_is_refused(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    old = await make_account(session, space_id, archived=True)

    error = await _reject(
        session, space_id, user_id, _data("adjustment", account_id=str(old.id), amount_minor=100)
    )

    assert (error.code, error.loc) == ("account_archived", ["body", "account_id"])


@pytest.mark.parametrize("field", ["from_account_id", "to_account_id"])
async def test_a_transfer_with_an_account_of_another_space_names_the_field(
    session: AsyncSession, field: str
) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    _, space_b = await make_user_and_space(session, "uid-b")
    mine = await make_account(session, space_a)
    theirs = await make_account(session, space_b)
    other = await make_account(session, space_a, name="Otra")
    ids = {"from_account_id": str(mine.id), "to_account_id": str(other.id), field: str(theirs.id)}

    error = await _reject(session, space_a, user_a, _data("transfer", amount_minor=100, **ids))

    assert (error.code, error.loc) == ("account_not_found", ["body", field])


@pytest.mark.parametrize("field", ["from_account_id", "to_account_id"])
async def test_a_transfer_with_an_archived_account_names_the_field(
    session: AsyncSession, field: str
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    active = await make_account(session, space_id)
    old = await make_account(session, space_id, name="Vieja", archived=True)
    other = await make_account(session, space_id, name="Otra")
    ids = {"from_account_id": str(active.id), "to_account_id": str(other.id), field: str(old.id)}

    error = await _reject(session, space_id, user_id, _data("transfer", amount_minor=100, **ids))

    assert (error.code, error.loc) == ("account_archived", ["body", field])


async def test_a_category_of_another_space_is_refused(session: AsyncSession) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    _, space_b = await make_user_and_space(session, "uid-b")
    account = await make_account(session, space_a)
    theirs = await make_category(session, space_b)

    error = await _reject(
        session,
        space_a,
        user_a,
        _data("expense", account_id=str(account.id), category_id=str(theirs.id), amount_minor=100),
    )

    assert (error.code, error.loc) == ("category_not_found", ["body", "category_id"])


async def test_a_missing_category_is_refused(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)

    error = await _reject(
        session,
        space_id,
        user_id,
        _data(
            "expense",
            account_id=str(account.id),
            category_id=str(uuid.uuid4()),
            amount_minor=100,
        ),
    )

    assert (error.code, error.loc) == ("category_not_found", ["body", "category_id"])


async def test_an_archived_category_is_refused_but_old_movements_keep_it(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    data = _data(
        "expense", account_id=str(account.id), category_id=str(category.id), amount_minor=100
    )
    old = await service.create_transaction(session, space_id, user_id, data)

    await categories_service.archive_category(session, space_id, category.id)

    error = await _reject(session, space_id, user_id, data)

    assert (error.code, error.loc) == ("category_archived", ["body", "category_id"])
    stored = await session.scalar(select(Entry.category_id).where(Entry.transaction_id == old.id))
    assert stored == category.id


async def test_a_subcategory_of_an_archived_main_category_is_refused(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    main = await make_category(session, space_id, name="Comida")
    sub = await make_category(session, space_id, name="Súper", parent_id=main.id)

    await categories_service.archive_category(session, space_id, main.id)

    error = await _reject(
        session,
        space_id,
        user_id,
        _data("expense", account_id=str(account.id), category_id=str(sub.id), amount_minor=100),
    )

    assert error.code == "category_archived"


@pytest.mark.parametrize(("kind", "category_kind"), [("expense", "income"), ("income", "expense")])
async def test_the_kind_of_the_category_must_match_the_type(
    session: AsyncSession, kind: str, category_kind: str
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id, kind=category_kind)

    error = await _reject(
        session,
        space_id,
        user_id,
        _data(kind, account_id=str(account.id), category_id=str(category.id), amount_minor=100),
    )

    assert (error.code, error.loc) == (
        "transaction_category_kind_mismatch",
        ["body", "category_id"],
    )


async def test_a_refused_transaction_does_not_touch_the_balances(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    old = await make_account(session, space_id, name="Vieja", archived=True)

    await _reject(
        session,
        space_id,
        user_id,
        _data(
            "transfer", from_account_id=str(account.id), to_account_id=str(old.id), amount_minor=5
        ),
    )

    assert await service.get_account_balances(session, space_id) == {}


# create_adjustment: initial balance and reconciliation write through it -----------------------

# 01:00 UTC of the 21st is still the 20th in Montevideo (UTC-3), where the test spaces live.
LATE_UTC = datetime(2026, 10, 21, 1, 0, tzinfo=UTC)


async def _stored(session: AsyncSession, transaction_id: uuid.UUID) -> Transaction:
    stored = await session.scalar(
        select(Transaction)
        .where(Transaction.id == transaction_id)
        .options(selectinload(Transaction.entries))
        .execution_options(populate_existing=True)
    )
    assert stored is not None
    return stored


async def test_create_adjustment_writes_a_confirmed_adjustment_without_category(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)

    result = await service.create_adjustment(
        session, space_id, user_id, account.id, 1_000_000, now=NOW
    )

    assert isinstance(result, TransactionRead)
    assert (result.type, result.status, result.description) == ("adjustment", "confirmed", None)
    assert [(e.account_id, e.amount_minor, e.category_id) for e in result.entries] == [
        (account.id, 1_000_000, None)
    ]
    stored = await _stored(session, result.id)
    assert (stored.space_id, stored.created_by, stored.deleted_at) == (space_id, user_id, None)
    assert [e.space_id for e in stored.entries] == [space_id]
    assert await service.get_account_balance(session, space_id, account.id) == 1_000_000


async def test_create_adjustment_dates_it_with_the_local_day_of_the_space(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")  # America/Montevideo
    account = await make_account(session, space_id)

    late = await service.create_adjustment(session, space_id, user_id, account.id, 10, now=LATE_UTC)
    noon = await service.create_adjustment(session, space_id, user_id, account.id, 10, now=NOW)

    assert late.date == date(2026, 10, 20)  # the UTC day is the 21st
    assert noon.date == date(2026, 10, 20)


async def test_create_adjustment_keeps_the_sign_on_a_credit_card(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    card = await make_account(session, space_id, type_="credit_card", name="Visa")

    await service.create_adjustment(session, space_id, user_id, card.id, -300_000, now=NOW)

    assert await service.get_account_balance(session, space_id, card.id) == -300_000
    summary = await service.get_balance_summary(session, space_id)
    assert (summary.available_minor, summary.card_debt_minor, summary.net_minor) == (
        0,
        300_000,
        -300_000,
    )


async def test_create_adjustment_refuses_an_archived_account(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    old = await make_account(session, space_id, archived=True)

    with pytest.raises(InvalidFieldError) as exc:
        await service.create_adjustment(session, space_id, user_id, old.id, 100, now=NOW)

    assert exc.value.code == "account_archived"
    assert await service.get_account_balances(session, space_id) == {}


async def test_create_adjustment_refuses_an_account_of_another_space(
    session: AsyncSession,
) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    _, space_b = await make_user_and_space(session, "uid-b")
    theirs = await make_account(session, space_b)

    with pytest.raises(InvalidFieldError) as exc:
        await service.create_adjustment(session, space_a, user_a, theirs.id, 100, now=NOW)

    assert exc.value.code == "account_not_found"
    assert await service.get_account_balances(session, space_b) == {}


# reconcile_account ----------------------------------------------------------------------------


async def test_reconcile_up_writes_an_adjustment_for_the_difference(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    await insert_transaction(
        session, space_id=space_id, user_id=user_id, entries=[(account.id, 10_000, None)]
    )

    result = await service.reconcile_account(
        session, space_id, user_id, account.id, balance_minor=12_550, now=NOW
    )

    assert result is not None
    assert (result.type, result.status) == ("adjustment", "confirmed")
    assert [(e.account_id, e.amount_minor, e.category_id) for e in result.entries] == [
        (account.id, 2_550, None)
    ]
    assert await service.get_account_balance(session, space_id, account.id) == 12_550


async def test_reconcile_down_writes_a_negative_adjustment(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    await insert_transaction(
        session, space_id=space_id, user_id=user_id, entries=[(account.id, 10_000, None)]
    )

    result = await service.reconcile_account(
        session, space_id, user_id, account.id, balance_minor=9_000, now=NOW
    )

    assert result is not None
    assert [e.amount_minor for e in result.entries] == [-1_000]
    assert await service.get_account_balance(session, space_id, account.id) == 9_000


async def test_reconcile_with_no_difference_writes_nothing(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    await insert_transaction(
        session, space_id=space_id, user_id=user_id, entries=[(account.id, 10_000, None)]
    )
    before = await _counts(session)

    result = await service.reconcile_account(
        session, space_id, user_id, account.id, balance_minor=10_000, now=NOW
    )

    assert result is None
    assert await _counts(session) == before
    assert await service.get_account_balance(session, space_id, account.id) == 10_000


async def test_reconcile_an_account_without_movements_to_zero_writes_nothing(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)

    result = await service.reconcile_account(
        session, space_id, user_id, account.id, balance_minor=0, now=NOW
    )

    assert result is None
    assert await _counts(session) == (0, 0)


async def test_reconcile_to_zero_clears_the_balance(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    await insert_transaction(
        session, space_id=space_id, user_id=user_id, entries=[(account.id, 4_321, None)]
    )

    result = await service.reconcile_account(
        session, space_id, user_id, account.id, balance_minor=0, now=NOW
    )

    assert result is not None
    assert [e.amount_minor for e in result.entries] == [-4_321]
    assert await service.get_account_balance(session, space_id, account.id) == 0


async def test_reconcile_a_credit_card_whose_debt_grew(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    await insert_transaction(
        session, space_id=space_id, user_id=user_id, entries=[(card.id, -300_000, None)]
    )

    result = await service.reconcile_account(
        session, space_id, user_id, card.id, balance_minor=-500_000, now=NOW
    )

    assert result is not None
    assert [e.amount_minor for e in result.entries] == [-200_000]  # the debt goes up
    summary = await service.get_balance_summary(session, space_id)
    assert summary.card_debt_minor == 500_000


async def test_reconcile_a_credit_card_whose_debt_shrank_or_became_a_credit(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    await insert_transaction(
        session, space_id=space_id, user_id=user_id, entries=[(card.id, -300_000, None)]
    )

    smaller = await service.reconcile_account(
        session, space_id, user_id, card.id, balance_minor=-100_000, now=NOW
    )
    in_favour = await service.reconcile_account(
        session, space_id, user_id, card.id, balance_minor=50_000, now=NOW
    )

    assert smaller is not None
    assert in_favour is not None
    assert [e.amount_minor for e in smaller.entries] == [200_000]
    assert [e.amount_minor for e in in_favour.entries] == [150_000]
    assert await service.get_account_balance(session, space_id, card.id) == 50_000


async def test_reconcile_only_counts_confirmed_movements_that_are_not_deleted(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    spec = (space_id, user_id)
    await insert_transaction(session, *spec, entries=[(account.id, 1_000, None)])
    await insert_transaction(session, *spec, entries=[(account.id, 7, None)], status="pending")
    await insert_transaction(session, *spec, entries=[(account.id, 70, None)], status="skipped")
    await insert_transaction(
        session, *spec, entries=[(account.id, 700, None)], deleted_at=datetime.now(UTC)
    )

    result = await service.reconcile_account(
        session, space_id, user_id, account.id, balance_minor=1_500, now=NOW
    )

    assert result is not None
    assert [e.amount_minor for e in result.entries] == [500]  # 1_500 - the 1_000 that counts
    assert await service.get_account_balance(session, space_id, account.id) == 1_500


async def test_reconcile_twice_with_the_same_balance_writes_one_adjustment(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)

    first = await service.reconcile_account(
        session, space_id, user_id, account.id, balance_minor=2_000, now=NOW
    )
    second = await service.reconcile_account(
        session, space_id, user_id, account.id, balance_minor=2_000, now=NOW
    )

    assert first is not None
    assert second is None
    assert await _counts(session) == (1, 1)


async def test_reconcile_touches_only_its_account_and_dates_the_adjustment_locally(
    session: AsyncSession,
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    other = await make_account(session, space_id, name="Otra")

    result = await service.reconcile_account(
        session, space_id, user_id, account.id, balance_minor=300, now=LATE_UTC
    )

    assert result is not None
    assert result.date == date(2026, 10, 20)
    assert await service.get_account_balances(session, space_id) == {account.id: 300}
    assert await service.get_account_balance(session, space_id, other.id) == 0


@pytest.mark.parametrize("balance", [0, 100])
async def test_reconcile_of_an_archived_account_is_a_conflict_even_without_difference(
    session: AsyncSession, balance: int
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    old = await make_account(session, space_id, archived=True)

    with pytest.raises(ConflictError) as exc:
        await service.reconcile_account(
            session, space_id, user_id, old.id, balance_minor=balance, now=NOW
        )

    assert exc.value.code == "account_archived"
    assert await _counts(session) == (0, 0)


async def test_reconcile_of_a_missing_account_is_not_found(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")

    with pytest.raises(NotFoundError) as exc:
        await service.reconcile_account(
            session, space_id, user_id, uuid.uuid4(), balance_minor=100, now=NOW
        )

    assert exc.value.code == "account_not_found"


async def test_reconcile_of_an_account_of_another_space_is_not_found_and_writes_nothing(
    session: AsyncSession,
) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    _, space_b = await make_user_and_space(session, "uid-b")
    theirs = await make_account(session, space_b)

    with pytest.raises(NotFoundError) as exc:
        await service.reconcile_account(
            session, space_a, user_a, theirs.id, balance_minor=100, now=NOW
        )

    assert exc.value.code == "account_not_found"
    assert await _counts(session) == (0, 0)


@pytest.mark.parametrize(
    ("current", "target"),
    [(-MAX_SAFE, MAX_SAFE), (MAX_SAFE, -MAX_SAFE), (-1, MAX_SAFE), (1, -MAX_SAFE)],
)
async def test_reconcile_with_a_difference_beyond_the_safe_limit_is_a_422_that_writes_nothing(
    session: AsyncSession, current: int, target: int
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    await insert_transaction(
        session, space_id=space_id, user_id=user_id, entries=[(account.id, current, None)]
    )
    before = await _counts(session)

    with pytest.raises(InvalidFieldError) as exc:
        await service.reconcile_account(
            session, space_id, user_id, account.id, balance_minor=target, now=NOW
        )

    assert (exc.value.code, exc.value.loc) == ("balance_out_of_range", ["body", "balance_minor"])
    assert await _counts(session) == before
    assert await service.get_account_balance(session, space_id, account.id) == current


async def test_reconcile_accepts_the_largest_difference_that_fits(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    await insert_transaction(
        session, space_id=space_id, user_id=user_id, entries=[(account.id, 1, None)]
    )

    result = await service.reconcile_account(
        session, space_id, user_id, account.id, balance_minor=MAX_SAFE, now=NOW
    )

    assert result is not None
    assert [e.amount_minor for e in result.entries] == [MAX_SAFE - 1]


# does the space have transactions? -----------------------------------------------------------


async def test_a_space_without_transactions_has_none(session: AsyncSession) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    await make_account(session, space_id)  # an account is not a movement

    assert await service.space_has_transactions(session, space_id) is False


@pytest.mark.parametrize(
    ("status", "deleted_at"),
    [
        ("confirmed", None),
        ("pending", None),
        ("skipped", None),
        ("confirmed", NOW),
        ("pending", NOW),
    ],
    ids=["confirmed", "pending", "skipped", "deleted", "deleted-pending"],
)
async def test_every_kind_of_transaction_counts_even_a_deleted_one(
    session: AsyncSession, status: str, deleted_at: datetime | None
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    await insert_transaction(
        session,
        space_id=space_id,
        user_id=user_id,
        entries=[(account.id, 1_000, None)],
        status=status,
        deleted_at=deleted_at,
    )

    assert await service.space_has_transactions(session, space_id) is True


async def test_a_transaction_created_by_the_service_counts(session: AsyncSession) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    account = await make_account(session, space_id)
    await service.create_adjustment(session, space_id, user_id, account.id, 500, now=NOW)

    assert await service.space_has_transactions(session, space_id) is True


async def test_the_transactions_of_another_space_do_not_count(session: AsyncSession) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    _, space_b = await make_user_and_space(session, "uid-b")
    account_a = await make_account(session, space_a)
    await insert_transaction(
        session, space_id=space_a, user_id=user_a, entries=[(account_a.id, 1_000, None)]
    )

    assert await service.space_has_transactions(session, space_a) is True
    assert await service.space_has_transactions(session, space_b) is False


async def test_an_unknown_space_has_no_transactions(session: AsyncSession) -> None:
    assert await service.space_has_transactions(session, uuid.uuid4()) is False

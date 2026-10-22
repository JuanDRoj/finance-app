import uuid
from typing import Any

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.transactions.models import Entry, Transaction
from tests.fakes import FakeFirebaseAuth, make_identity
from tests.transactions_helpers import (
    insert_transaction,
    make_account,
    make_category,
    make_user_and_space,
)

COOKIE = {"Cookie": "session=valid-cookie"}
SPACE_NOT_FOUND = {"detail": "Space not found", "code": "space_not_found"}
NOT_AUTHENTICATED = {"detail": "Not authenticated", "code": "not_authenticated"}
MAX_SAFE = 2**53 - 1
DAY = "2026-10-20"


def _url(space_id: uuid.UUID) -> str:
    return f"/spaces/{space_id}/transactions"


def _sign_in_as(fake: FakeFirebaseAuth, uid: str) -> None:
    fake.session_identity = make_identity(uid=uid)


async def _post(client: AsyncClient, space_id: uuid.UUID, /, **body: Any) -> Response:
    return await client.post(_url(space_id), json=body, headers=COOKIE)


async def _counts(session: AsyncSession) -> tuple[int, int]:
    transactions = await session.scalar(select(func.count()).select_from(Transaction))
    entries = await session.scalar(select(func.count()).select_from(Entry))
    return transactions or 0, entries or 0


async def _balance(client: AsyncClient, space_id: uuid.UUID, account_id: uuid.UUID) -> int:
    response = await client.get(f"/spaces/{space_id}/accounts/{account_id}", headers=COOKIE)
    assert response.status_code == 200, response.text
    balance: int = response.json()["balance_minor"]
    return balance


async def _summary(client: AsyncClient, space_id: uuid.UUID) -> dict[str, int]:
    response = await client.get(f"/spaces/{space_id}/balance-summary", headers=COOKIE)
    assert response.status_code == 200, response.text
    summary: dict[str, int] = response.json()
    return summary


def _issues(response: Response) -> list[tuple[str, list[str]]]:
    """`(type, loc)` of each 422 issue: the part of the body the frontend maps to a form field."""
    assert response.status_code == 422, response.text
    return [(issue["type"], issue["loc"]) for issue in response.json()["detail"]]


def _expense(account_id: uuid.UUID | str, category_id: uuid.UUID | str, **fields: Any) -> Any:
    return {
        "type": "expense",
        "date": DAY,
        "account_id": str(account_id),
        "category_id": str(category_id),
        "amount_minor": 1550,
        **fields,
    }


def _income(account_id: uuid.UUID | str, category_id: uuid.UUID | str, **fields: Any) -> Any:
    return {
        "type": "income",
        "date": DAY,
        "account_id": str(account_id),
        "category_id": str(category_id),
        "amount_minor": 90_000,
        **fields,
    }


def _transfer(from_id: uuid.UUID | str, to_id: uuid.UUID | str, **fields: Any) -> Any:
    return {
        "type": "transfer",
        "date": DAY,
        "from_account_id": str(from_id),
        "to_account_id": str(to_id),
        "amount_minor": 3_000,
        **fields,
    }


# creating an expense, an income, a transfer ---------------------------------------------------


async def test_create_an_expense(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)

    response = await _post(
        api_client, space_id, **_expense(account.id, category.id, description="  Súper ")
    )

    assert response.status_code == 201
    body = response.json()
    assert uuid.UUID(body["id"]).version == 7
    [entry] = body["entries"]
    assert uuid.UUID(entry.pop("id")).version == 7
    assert body == {
        "id": body["id"],
        "type": "expense",
        "status": "confirmed",
        "date": DAY,
        "description": "Súper",
        "entries": [
            {"account_id": str(account.id), "amount_minor": -1550, "category_id": str(category.id)}
        ],
    }
    stored = await session.scalar(
        select(Transaction).where(Transaction.id == uuid.UUID(body["id"]))
    )
    assert stored is not None
    assert (stored.space_id, stored.created_by, stored.deleted_at) == (space_id, user_id, None)
    assert await _balance(api_client, space_id, account.id) == -1550


async def test_create_an_income(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id, kind="income", name="Sueldo")

    response = await _post(api_client, space_id, **_income(account.id, category.id))

    assert response.status_code == 201
    body = response.json()
    assert (body["type"], body["status"], body["description"]) == ("income", "confirmed", None)
    assert [(e["amount_minor"], e["category_id"]) for e in body["entries"]] == [
        (90_000, str(category.id))
    ]
    assert await _balance(api_client, space_id, account.id) == 90_000


async def test_create_a_transfer_adds_up_to_zero_and_has_no_category(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, type_="cash", name="Billetera")
    await insert_transaction(
        session, space_id=space_id, user_id=user_id, entries=[(bank.id, 10_000, None)]
    )

    response = await _post(api_client, space_id, **_transfer(bank.id, cash.id))

    assert response.status_code == 201
    body = response.json()
    assert (body["type"], body["status"]) == ("transfer", "confirmed")
    assert [(e["account_id"], e["amount_minor"], e["category_id"]) for e in body["entries"]] == [
        (str(bank.id), -3_000, None),
        (str(cash.id), 3_000, None),
    ]
    assert sum(e["amount_minor"] for e in body["entries"]) == 0
    assert await _balance(api_client, space_id, bank.id) == 7_000
    assert await _balance(api_client, space_id, cash.id) == 3_000


@pytest.mark.parametrize("description", [None, "omitted"])
async def test_the_description_is_optional(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    description: str | None,
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    extra = {} if description == "omitted" else {"description": None}

    response = await _post(api_client, space_id, **_expense(account.id, category.id, **extra))

    assert response.status_code == 201
    assert response.json()["description"] is None


async def test_a_movement_may_go_to_a_main_category_with_subcategories(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    account = await make_account(session, space_id)
    main = await make_category(session, space_id, name="Comida")
    sub = await make_category(session, space_id, name="Súper", parent_id=main.id)

    for category in (main, sub):
        response = await _post(api_client, space_id, **_expense(account.id, category.id))
        assert response.status_code == 201
        assert response.json()["entries"][0]["category_id"] == str(category.id)


async def test_the_largest_safe_amount_is_accepted(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id, kind="income", name="Sueldo")

    response = await _post(
        api_client, space_id, **_income(account.id, category.id, amount_minor=MAX_SAFE)
    )

    assert response.status_code == 201
    assert await _balance(api_client, space_id, account.id) == MAX_SAFE


async def test_the_date_is_stored_as_sent_and_a_future_date_is_accepted(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")  # America/Montevideo
    _sign_in_as(fake_firebase, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)

    for day in ("2026-10-20", "2031-01-31"):
        response = await _post(api_client, space_id, **_expense(account.id, category.id, date=day))
        assert response.status_code == 201
        assert response.json()["date"] == day


async def test_a_created_movement_locks_the_currency_of_the_space(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    before = await api_client.get(f"/spaces/{space_id}", headers=COOKIE)

    await _post(api_client, space_id, **_expense(account.id, category.id))
    after = await api_client.get(f"/spaces/{space_id}", headers=COOKIE)

    assert (before.json()["currency_locked"], after.json()["currency_locked"]) == (False, True)


# credit cards ---------------------------------------------------------------------------------


async def test_an_expense_on_a_credit_card_raises_the_debt(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    category = await make_category(session, space_id)

    response = await _post(
        api_client, space_id, **_expense(card.id, category.id, amount_minor=4_500)
    )

    assert response.status_code == 201
    assert response.json()["entries"][0]["amount_minor"] == -4_500
    assert await _balance(api_client, space_id, card.id) == -4_500  # negative = you owe
    summary = await _summary(api_client, space_id)
    assert (summary["available_minor"], summary["card_debt_minor"], summary["net_minor"]) == (
        0,
        4_500,
        -4_500,
    )


async def test_a_transfer_from_a_bank_to_a_credit_card_lowers_the_debt_and_keeps_the_net(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    card = await make_account(session, space_id, type_="credit_card", name="Visa")
    spec = (space_id, user_id)
    await insert_transaction(session, *spec, entries=[(bank.id, 10_000, None)])
    await insert_transaction(session, *spec, entries=[(card.id, -10_000, None)])
    before = await _summary(api_client, space_id)

    response = await _post(api_client, space_id, **_transfer(bank.id, card.id, amount_minor=3_000))

    assert response.status_code == 201
    assert await _balance(api_client, space_id, bank.id) == 7_000
    assert await _balance(api_client, space_id, card.id) == -7_000
    after = await _summary(api_client, space_id)
    assert (before["available_minor"], before["card_debt_minor"]) == (10_000, 10_000)
    assert (after["available_minor"], after["card_debt_minor"]) == (7_000, 7_000)
    assert after["net_minor"] == before["net_minor"] == 0


async def test_a_transfer_from_a_credit_card_to_a_bank_raises_the_debt(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    card = await make_account(session, space_id, type_="credit_card", name="Visa")

    response = await _post(api_client, space_id, **_transfer(card.id, bank.id, amount_minor=900))

    assert response.status_code == 201
    assert await _balance(api_client, space_id, card.id) == -900
    assert await _balance(api_client, space_id, bank.id) == 900
    assert (await _summary(api_client, space_id))["card_debt_minor"] == 900


# 422 by field: the body (Pydantic) -------------------------------------------------------------


def _bodies(account: str, other: str, category: str) -> dict[str, dict[str, Any]]:
    return {
        "expense": _expense(account, category),
        "income": _income(account, category),
        "transfer": _transfer(account, other),
    }


@pytest.mark.parametrize("kind", ["expense", "income"])
async def test_an_expense_and_an_income_need_a_category(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, kind: str
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    account = await make_account(session, space_id)
    body = _bodies(str(account.id), str(uuid.uuid4()), str(uuid.uuid4()))[kind]
    del body["category_id"]

    response = await _post(api_client, space_id, **body)

    assert _issues(response) == [("missing", ["body", kind, "category_id"])]
    assert await _counts(session) == (0, 0)


@pytest.mark.parametrize(
    ("kind", "field"),
    [
        ("expense", "account_id"),
        ("income", "account_id"),
        ("transfer", "from_account_id"),
        ("transfer", "to_account_id"),
        ("expense", "amount_minor"),
        ("income", "amount_minor"),
        ("transfer", "amount_minor"),
        ("expense", "date"),
        ("income", "date"),
        ("transfer", "date"),
    ],
)
async def test_a_missing_required_field_is_a_422_on_that_field(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    kind: str,
    field: str,
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    body = _bodies(str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4()))[kind]
    del body[field]

    response = await _post(api_client, space_id, **body)

    assert _issues(response) == [("missing", ["body", kind, field])]
    assert await _counts(session) == (0, 0)


@pytest.mark.parametrize("kind", ["expense", "income", "transfer"])
@pytest.mark.parametrize("amount", [0, -1, MAX_SAFE + 1, 15.5, 1550.0, "1550", True, None])
async def test_an_amount_must_be_a_positive_integer_within_the_safe_limit(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    kind: str,
    amount: object,
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    body = _bodies(str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4()))[kind]
    body["amount_minor"] = amount

    response = await _post(api_client, space_id, **body)

    [(_, loc)] = _issues(response)
    assert loc == ["body", kind, "amount_minor"]
    assert await _counts(session) == (0, 0)


async def test_a_transfer_between_the_same_account_is_a_422_on_the_destination(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    account = await make_account(session, space_id)

    response = await _post(api_client, space_id, **_transfer(account.id, account.id))

    assert _issues(response) == [("transfer_same_account", ["body", "transfer", "to_account_id"])]
    assert await _counts(session) == (0, 0)


@pytest.mark.parametrize(
    ("kind", "field"),
    [
        ("transfer", "category_id"),
        ("expense", "to_account_id"),
        ("expense", "status"),
        ("expense", "space_id"),
        ("income", "created_by"),
        ("transfer", "entries"),
        ("expense", "deleted_at"),
    ],
)
async def test_a_field_that_is_not_part_of_the_type_is_a_422(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    kind: str,
    field: str,
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    body = _bodies(str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4()))[kind]
    body[field] = str(uuid.uuid4())

    response = await _post(api_client, space_id, **body)

    assert _issues(response) == [("extra_forbidden", ["body", kind, field])]
    assert await _counts(session) == (0, 0)


@pytest.mark.parametrize(
    ("body", "issue_type"),
    [
        (
            {"type": "adjustment", "date": DAY, "account_id": str(uuid.uuid4()), "amount_minor": 5},
            "union_tag_invalid",
        ),
        ({"type": "refund", "date": DAY}, "union_tag_invalid"),
        ({"type": "EXPENSE", "date": DAY}, "union_tag_invalid"),
        ({"date": DAY, "amount_minor": 5}, "union_tag_not_found"),
    ],
    ids=["adjustment", "unknown", "uppercase", "missing"],
)
async def test_an_unknown_missing_or_adjustment_type_is_a_422(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    body: dict[str, Any],
    issue_type: str,
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await _post(api_client, space_id, **body)

    assert _issues(response) == [(issue_type, ["body"])]
    assert await _counts(session) == (0, 0)


@pytest.mark.parametrize(
    "value",
    [
        "2026-10-20T00:00:00",
        "2026-10-20T00:00:00Z",
        "20/10/2026",
        "2026-13-01",
        "2026-02-30",
        "",
        None,
        1760918400,
        "2026-10-20\n",
    ],
)
async def test_the_date_must_be_a_plain_iso_date(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, value: object
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    body = _expense(uuid.uuid4(), uuid.uuid4(), date=value)

    response = await _post(api_client, space_id, **body)

    [(_, loc)] = _issues(response)
    assert loc == ["body", "expense", "date"]
    assert await _counts(session) == (0, 0)


@pytest.mark.parametrize("description", ["", "   ", "a" * 201, 5, ["x"]])
async def test_a_blank_too_long_or_non_string_description_is_a_422(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    description: object,
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    body = _expense(uuid.uuid4(), uuid.uuid4(), description=description)

    response = await _post(api_client, space_id, **body)

    [(_, loc)] = _issues(response)
    assert loc == ["body", "expense", "description"]
    assert await _counts(session) == (0, 0)


@pytest.mark.parametrize("field", ["account_id", "category_id"])
async def test_ids_must_be_uuids(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, field: str
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    body = _expense(uuid.uuid4(), uuid.uuid4())
    body[field] = "not-a-uuid"

    response = await _post(api_client, space_id, **body)

    [(_, loc)] = _issues(response)
    assert loc == ["body", "expense", field]


async def test_every_field_that_fails_is_reported(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    body = _expense(uuid.uuid4(), uuid.uuid4(), amount_minor=0, date="nope")

    response = await _post(api_client, space_id, **body)

    assert sorted(loc[-1] for _, loc in _issues(response)) == ["amount_minor", "date"]


async def test_a_body_that_is_not_an_object_is_a_422(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.post(_url(space_id), json=[1, 2], headers=COOKIE)

    assert response.status_code == 422
    assert await _counts(session) == (0, 0)


# 422 by field: rules that need the database (the service) -----------------------------------


@pytest.mark.parametrize("kind", ["expense", "income"])
async def test_an_archived_account_is_a_422_on_the_account(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, kind: str
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    old = await make_account(session, space_id, archived=True)
    category = await make_category(session, space_id, kind=kind)
    body = _bodies(str(old.id), str(uuid.uuid4()), str(category.id))[kind]

    response = await _post(api_client, space_id, **body)

    assert _issues(response) == [("account_archived", ["body", kind, "account_id"])]
    assert await _counts(session) == (0, 0)


@pytest.mark.parametrize("field", ["from_account_id", "to_account_id"])
async def test_a_transfer_with_an_archived_account_names_the_field(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, field: str
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    active = await make_account(session, space_id)
    other = await make_account(session, space_id, name="Otra")
    old = await make_account(session, space_id, name="Vieja", archived=True)
    ids = {"from_account_id": active.id, "to_account_id": other.id, field: old.id}

    response = await _post(
        api_client, space_id, **_transfer(ids["from_account_id"], ids["to_account_id"])
    )

    assert _issues(response) == [("account_archived", ["body", "transfer", field])]
    assert await _counts(session) == (0, 0)


@pytest.mark.parametrize("kind", ["expense", "income"])
async def test_a_missing_account_is_a_422_on_the_account(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, kind: str
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    category = await make_category(session, space_id, kind=kind)
    body = _bodies(str(uuid.uuid4()), str(uuid.uuid4()), str(category.id))[kind]

    response = await _post(api_client, space_id, **body)

    assert _issues(response) == [("account_not_found", ["body", kind, "account_id"])]
    assert await _counts(session) == (0, 0)


async def test_an_archived_category_is_a_422_on_the_category(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    account = await make_account(session, space_id)
    old = await make_category(session, space_id, archived=True)

    response = await _post(api_client, space_id, **_expense(account.id, old.id))

    assert _issues(response) == [("category_archived", ["body", "expense", "category_id"])]
    assert await _counts(session) == (0, 0)


async def test_a_missing_category_is_a_422_on_the_category(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    account = await make_account(session, space_id)

    response = await _post(api_client, space_id, **_expense(account.id, uuid.uuid4()))

    assert _issues(response) == [("category_not_found", ["body", "expense", "category_id"])]
    assert await _counts(session) == (0, 0)


@pytest.mark.parametrize(("kind", "category_kind"), [("expense", "income"), ("income", "expense")])
async def test_the_kind_of_the_category_must_match_the_type(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    kind: str,
    category_kind: str,
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id, kind=category_kind)
    body = _bodies(str(account.id), str(uuid.uuid4()), str(category.id))[kind]

    response = await _post(api_client, space_id, **body)

    assert _issues(response) == [
        ("transaction_category_kind_mismatch", ["body", kind, "category_id"])
    ]
    assert await _counts(session) == (0, 0)


async def test_a_refused_transfer_leaves_the_balances_untouched(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    old = await make_account(session, space_id, name="Vieja", archived=True)
    await insert_transaction(
        session, space_id=space_id, user_id=user_id, entries=[(bank.id, 5_000, None)]
    )
    before = await _counts(session)

    response = await _post(api_client, space_id, **_transfer(bank.id, old.id, amount_minor=100))

    assert response.status_code == 422
    assert await _counts(session) == before
    assert await _balance(api_client, space_id, bank.id) == 5_000


async def test_the_rules_of_the_database_and_of_the_body_use_the_same_location_for_a_field(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    # `category_id` is rejected once by Pydantic (not a uuid) and once by the service (not found):
    # the frontend must find the same path in both.
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    account = await make_account(session, space_id)

    by_schema = await _post(api_client, space_id, **_expense(account.id, "not-a-uuid"))
    by_service = await _post(api_client, space_id, **_expense(account.id, uuid.uuid4()))

    assert [loc for _, loc in _issues(by_schema)] == [loc for _, loc in _issues(by_service)]


# authentication and IDOR ---------------------------------------------------------------------


async def test_creating_a_movement_without_a_session_is_a_401(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")

    response = await api_client.post(_url(space_id), json=_expense(uuid.uuid4(), uuid.uuid4()))

    assert (response.status_code, response.json()) == (401, NOT_AUTHENTICATED)
    assert not fake_firebase.called
    assert await _counts(session) == (0, 0)


async def test_user_b_gets_404_when_creating_a_movement_in_the_space_of_user_a(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_a = await make_user_and_space(session, "uid-a")
    await make_user_and_space(session, "uid-b")
    account = await make_account(session, space_a, name="Cuenta secreta")
    category = await make_category(session, space_a, name="Categoría secreta")
    _sign_in_as(fake_firebase, "uid-b")

    response = await _post(api_client, space_a, **_expense(account.id, category.id))

    assert (response.status_code, response.json()) == (404, SPACE_NOT_FOUND)
    assert "secret" not in response.text
    assert await _counts(session) == (0, 0)
    _sign_in_as(fake_firebase, "uid-a")
    assert await _balance(api_client, space_a, account.id) == 0


async def test_user_b_with_an_invalid_body_still_gets_404_in_the_space_of_user_a(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_a = await make_user_and_space(session, "uid-a")
    await make_user_and_space(session, "uid-b")
    _sign_in_as(fake_firebase, "uid-b")

    response = await _post(api_client, space_a, type="expense", amount_minor=-5)

    assert (response.status_code, response.json()) == (404, SPACE_NOT_FOUND)


async def test_a_movement_cannot_use_an_account_of_another_space(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    _, space_b = await make_user_and_space(session, "uid-b")
    theirs = await make_account(session, space_a, name="Cuenta de A")
    mine = await make_account(session, space_b, name="Cuenta de B")
    category = await make_category(session, space_b)
    await insert_transaction(
        session, space_id=space_a, user_id=user_a, entries=[(theirs.id, 5_000, None)]
    )
    _sign_in_as(fake_firebase, "uid-b")
    before = await _counts(session)

    as_expense = await _post(api_client, space_b, **_expense(theirs.id, category.id))
    as_origin = await _post(api_client, space_b, **_transfer(theirs.id, mine.id))
    as_destination = await _post(api_client, space_b, **_transfer(mine.id, theirs.id))

    assert _issues(as_expense) == [("account_not_found", ["body", "expense", "account_id"])]
    assert _issues(as_origin) == [("account_not_found", ["body", "transfer", "from_account_id"])]
    assert _issues(as_destination) == [("account_not_found", ["body", "transfer", "to_account_id"])]
    assert "Cuenta de A" not in as_expense.text + as_origin.text + as_destination.text
    assert await _counts(session) == before
    assert await _balance(api_client, space_b, mine.id) == 0
    _sign_in_as(fake_firebase, "uid-a")
    assert await _balance(api_client, space_a, theirs.id) == 5_000


async def test_a_foreign_account_answers_exactly_like_a_missing_one(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_a = await make_user_and_space(session, "uid-a")
    _, space_b = await make_user_and_space(session, "uid-b")
    theirs = await make_account(session, space_a)
    category = await make_category(session, space_b)
    _sign_in_as(fake_firebase, "uid-b")

    foreign = await _post(api_client, space_b, **_expense(theirs.id, category.id))
    missing = await _post(api_client, space_b, **_expense(uuid.uuid4(), category.id))

    assert foreign.status_code == missing.status_code == 422
    assert [{k: v for k, v in i.items() if k != "input"} for i in foreign.json()["detail"]] == [
        {k: v for k, v in i.items() if k != "input"} for i in missing.json()["detail"]
    ]


@pytest.mark.parametrize("kind", ["expense", "income"])
async def test_a_movement_cannot_use_a_category_of_another_space(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, kind: str
) -> None:
    _, space_a = await make_user_and_space(session, "uid-a")
    _, space_b = await make_user_and_space(session, "uid-b")
    theirs = await make_category(session, space_a, kind=kind, name="Categoría de A")
    mine = await make_account(session, space_b)
    _sign_in_as(fake_firebase, "uid-b")
    body = _bodies(str(mine.id), str(uuid.uuid4()), str(theirs.id))[kind]

    response = await _post(api_client, space_b, **body)

    assert _issues(response) == [("category_not_found", ["body", kind, "category_id"])]
    assert "Categoría de A" not in response.text
    assert await _counts(session) == (0, 0)
    assert await _balance(api_client, space_b, mine.id) == 0

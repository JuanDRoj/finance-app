"""`GET /spaces/{id}/transactions`, `.../summary` and `.../{transaction_id}` over HTTP."""

import uuid
from datetime import date
from typing import Any

import pytest
from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from tests.fakes import FakeFirebaseAuth, make_identity
from tests.transactions_helpers import (
    insert_adjustment,
    insert_expense,
    insert_income,
    insert_transfer,
    make_account,
    make_category,
    make_user_and_space,
)

COOKIE = {"Cookie": "session=valid-cookie"}
SPACE_NOT_FOUND = {"detail": "Space not found", "code": "space_not_found"}
NOT_AUTHENTICATED = {"detail": "Not authenticated", "code": "not_authenticated"}
TRANSACTION_NOT_FOUND = {"detail": "Transaction not found", "code": "transaction_not_found"}
DAY = date(2026, 10, 20)


def _url(space_id: uuid.UUID, tail: str = "") -> str:
    return f"/spaces/{space_id}/transactions{tail}"


def _sign_in_as(fake: FakeFirebaseAuth, uid: str) -> None:
    fake.session_identity = make_identity(uid=uid)


async def _get(client: AsyncClient, space_id: uuid.UUID, tail: str = "", **params: Any) -> Response:
    return await client.get(_url(space_id, tail), params=params, headers=COOKIE)


def _issues(response: Response) -> list[tuple[str, list[str]]]:
    assert response.status_code == 422, response.text
    return [(issue["type"], issue["loc"]) for issue in response.json()["detail"]]


# the list ---------------------------------------------------------------------------------------


async def test_the_list_has_items_and_a_cursor(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    account = await make_account(session, space_id, name="Itaú")
    category = await make_category(session, space_id, name="Comida")
    created = await insert_expense(
        session, space_id, user_id, account.id, category.id, 1550, description="Almuerzo"
    )

    response = await _get(api_client, space_id)

    assert response.status_code == 200, response.text
    assert response.json() == {
        "items": [
            {
                "id": str(created.id),
                "type": "expense",
                "status": "confirmed",
                "date": "2026-10-20",
                "description": "Almuerzo",
                "amount_minor": -1550,
                "category": {
                    "id": str(category.id),
                    "name": "Comida",
                    "icon": "fork-knife",
                    "parent": None,
                },
                "account": {"id": str(account.id), "name": "Itaú", "type": "bank"},
                "from_account": None,
                "to_account": None,
                "balance_after_minor": None,
            }
        ],
        "next_cursor": None,
    }


async def test_a_transfer_is_shown_with_both_accounts_and_no_sign(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id, name="Itaú")
    card = await make_account(session, space_id, name="Visa", type_="credit_card")
    await insert_transfer(session, space_id, user_id, bank.id, card.id, 3000)

    [item] = (await _get(api_client, space_id)).json()["items"]

    assert item["type"] == "transfer"
    assert item["amount_minor"] == 3000
    assert item["category"] is None
    assert item["account"] is None
    assert item["from_account"] == {"id": str(bank.id), "name": "Itaú", "type": "bank"}
    assert item["to_account"] == {"id": str(card.id), "name": "Visa", "type": "credit_card"}


async def test_the_pages_can_be_followed_with_the_cursor_over_http(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    for i in range(7):  # all on the same date: the id breaks the tie
        await insert_expense(session, space_id, user_id, account.id, category.id, 100 + i)

    everything = [item["id"] for item in (await _get(api_client, space_id)).json()["items"]]
    seen: list[str] = []
    cursor: str | None = None
    sizes: list[int] = []
    while True:
        params: dict[str, Any] = {"limit": 3}
        if cursor:
            params["cursor"] = cursor
        body = (await _get(api_client, space_id, **params)).json()
        sizes.append(len(body["items"]))
        seen += [item["id"] for item in body["items"]]
        cursor = body["next_cursor"]
        if cursor is None:
            break

    assert sizes == [3, 3, 1]
    assert seen == everything
    assert len(set(seen)) == 7


async def test_filters_are_read_from_the_query_string(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    cash = await make_account(session, space_id, name="Efectivo", type_="cash")
    food = await make_category(session, space_id, name="Comida")
    market = await make_category(session, space_id, name="Super", parent_id=food.id)
    target = await insert_expense(
        session, space_id, user_id, bank.id, market.id, 100, description="Café", day=DAY
    )
    await insert_expense(session, space_id, user_id, cash.id, market.id, 100, description="Café")
    await insert_expense(
        session,
        space_id,
        user_id,
        bank.id,
        market.id,
        100,
        description="Café",
        day=date(2026, 9, 1),
    )
    await insert_income(
        session,
        space_id,
        user_id,
        bank.id,
        (await make_category(session, space_id, kind="income", name="Sueldo")).id,
        100,
    )

    response = await _get(
        api_client,
        space_id,
        month="2026-10",
        type="expense",
        account_id=str(bank.id),
        category_id=str(food.id),
        q="CAFE",
        limit=10,
    )

    assert response.status_code == 200, response.text
    assert [item["id"] for item in response.json()["items"]] == [str(target.id)]


async def test_filtering_by_account_adds_the_balance_after_each_movement(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    card = await make_account(session, space_id, name="Visa", type_="credit_card")
    category = await make_category(session, space_id)
    await insert_expense(
        session, space_id, user_id, card.id, category.id, 900, day=date(2026, 10, 1)
    )
    await insert_expense(
        session, space_id, user_id, card.id, category.id, 100, day=date(2026, 10, 2)
    )

    items = (await _get(api_client, space_id, account_id=str(card.id))).json()["items"]

    assert [(item["amount_minor"], item["balance_after_minor"]) for item in items] == [
        (-100, -1000),
        (-900, -900),
    ]


# bad requests -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("params", "expected"),
    [
        ({"limit": 0}, ("greater_than_equal", ["query", "limit"])),
        ({"limit": 101}, ("less_than_equal", ["query", "limit"])),
        ({"limit": "many"}, ("int_parsing", ["query", "limit"])),
        ({"cursor": "garbage"}, ("cursor_invalid", ["query", "cursor"])),
        ({"cursor": ""}, ("cursor_invalid", ["query", "cursor"])),
        ({"month": "2026-13"}, ("string_pattern_mismatch", ["query", "month"])),
        ({"month": "october"}, ("string_pattern_mismatch", ["query", "month"])),
        ({"type": "all"}, ("literal_error", ["query", "type"])),
        ({"account_id": "nope"}, ("uuid_parsing", ["query", "account_id"])),
        ({"category_id": "nope"}, ("uuid_parsing", ["query", "category_id"])),
        ({"q": "   "}, ("string_too_short", ["query", "q"])),
        ({"sort": "amount"}, ("extra_forbidden", ["query", "sort"])),
    ],
)
async def test_bad_parameters_are_a_422_on_the_parameter(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    params: dict[str, Any],
    expected: tuple[str, list[str]],
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    assert _issues(await _get(api_client, space_id, **params)) == [expected]


async def test_the_limits_of_the_page_size_are_accepted(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    for limit in (1, 100):
        assert (await _get(api_client, space_id, limit=limit)).status_code == 200


async def test_the_routes_need_a_session(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    for tail in ("", "/summary", f"/{uuid.uuid4()}"):
        response = await api_client.get(_url(space_id, tail))
        assert response.status_code == 401
        assert response.json() == NOT_AUTHENTICATED


# IDOR -------------------------------------------------------------------------------------------


async def test_another_user_gets_404_on_the_list_the_summary_and_the_detail_of_a_space(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    await make_user_and_space(session, "uid-b")
    account = await make_account(session, space_a)
    category = await make_category(session, space_a)
    mine = await insert_expense(session, space_a, user_a, account.id, category.id, 100)
    _sign_in_as(fake_firebase, "uid-b")

    for tail in ("", "/summary", f"/{mine.id}"):
        response = await _get(api_client, space_a, tail)
        assert response.status_code == 404, (tail, response.text)
        assert response.json() == SPACE_NOT_FOUND


async def test_a_movement_of_another_space_is_not_found_even_from_your_own_space(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    _, space_b = await make_user_and_space(session, "uid-b")
    account = await make_account(session, space_a)
    category = await make_category(session, space_a)
    theirs = await insert_expense(session, space_a, user_a, account.id, category.id, 100)
    _sign_in_as(fake_firebase, "uid-b")

    foreign = await _get(api_client, space_b, f"/{theirs.id}")
    unknown = await _get(api_client, space_b, f"/{uuid.uuid4()}")

    assert foreign.status_code == 404
    assert foreign.json() == TRANSACTION_NOT_FOUND
    assert foreign.json() == unknown.json()


async def test_filtering_by_an_account_or_category_of_another_space_shows_nothing(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    user_b, space_b = await make_user_and_space(session, "uid-b")
    account_a = await make_account(session, space_a)
    category_a = await make_category(session, space_a)
    await insert_expense(session, space_a, user_a, account_a.id, category_a.id, 100)
    account_b = await make_account(session, space_b)
    category_b = await make_category(session, space_b)
    await insert_expense(session, space_b, user_b, account_b.id, category_b.id, 100)
    _sign_in_as(fake_firebase, "uid-b")
    empty_summary = {"count": 0, "income_minor": 0, "expense_minor": 0, "remaining_minor": 0}

    for params in ({"account_id": str(account_a.id)}, {"category_id": str(category_a.id)}):
        listing = await _get(api_client, space_b, **params)
        assert listing.status_code == 200
        assert listing.json() == {"items": [], "next_cursor": None}
        summary = await _get(api_client, space_b, "/summary", **params)
        assert summary.status_code == 200
        assert summary.json() == empty_summary


async def test_a_cursor_from_another_space_gives_only_your_own_data(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_a, space_a = await make_user_and_space(session, "uid-a")
    user_b, space_b = await make_user_and_space(session, "uid-b")
    account_a = await make_account(session, space_a)
    category_a = await make_category(session, space_a)
    for i in range(3):
        await insert_expense(session, space_a, user_a, account_a.id, category_a.id, 100 + i)
    account_b = await make_account(session, space_b)
    category_b = await make_category(session, space_b)
    mine = await insert_expense(
        session, space_b, user_b, account_b.id, category_b.id, 100, day=date(2026, 10, 1)
    )
    _sign_in_as(fake_firebase, "uid-a")
    cursor = (await _get(api_client, space_a, limit=1)).json()["next_cursor"]
    _sign_in_as(fake_firebase, "uid-b")

    response = await _get(api_client, space_b, cursor=cursor, limit=100)

    assert response.status_code == 200
    # A cursor is only a position: it cannot bring anything of space A.
    assert [item["id"] for item in response.json()["items"]] == [str(mine.id)]


# the summary ------------------------------------------------------------------------------------


async def test_the_summary_of_the_period(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id)
    expense_category = await make_category(session, space_id)
    income_category = await make_category(session, space_id, kind="income", name="Sueldo")
    await insert_income(session, space_id, user_id, bank.id, income_category.id, 9_000_000)
    await insert_expense(session, space_id, user_id, bank.id, expense_category.id, 4_670_000)
    await insert_adjustment(session, space_id, user_id, bank.id, 1_000)
    await insert_expense(
        session, space_id, user_id, bank.id, expense_category.id, 1, day=date(2026, 9, 1)
    )

    response = await _get(api_client, space_id, "/summary", month="2026-10")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "count": 3,
        "income_minor": 9_000_000,
        "expense_minor": 4_670_000,
        "remaining_minor": 4_330_000,
    }


@pytest.mark.parametrize("param", [{"limit": 10}, {"cursor": "abc"}])
async def test_the_summary_does_not_page(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    param: dict[str, Any],
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    [(kind, loc)] = _issues(await _get(api_client, space_id, "/summary", **param))
    assert kind == "extra_forbidden"
    assert loc == ["query", next(iter(param))]


async def test_summary_is_a_route_and_not_a_transaction_id(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    response = await _get(api_client, space_id, "/summary")
    assert response.status_code == 200
    assert response.json()["count"] == 0


# the detail -------------------------------------------------------------------------------------


async def test_the_detail_of_each_type(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    bank = await make_account(session, space_id, name="Itaú")
    cash = await make_account(session, space_id, name="Efectivo", type_="cash")
    expense_category = await make_category(session, space_id)
    income_category = await make_category(session, space_id, kind="income", name="Sueldo")
    expense = await insert_expense(session, space_id, user_id, bank.id, expense_category.id, 1550)
    income = await insert_income(session, space_id, user_id, bank.id, income_category.id, 90_000)
    transfer = await insert_transfer(session, space_id, user_id, bank.id, cash.id, 3000)
    adjustment = await insert_adjustment(session, space_id, user_id, cash.id, -250)

    async def detail(transaction_id: uuid.UUID) -> dict[str, Any]:
        response = await _get(api_client, space_id, f"/{transaction_id}")
        assert response.status_code == 200, response.text
        body: dict[str, Any] = response.json()
        return body

    shown = await detail(expense.id)
    assert (shown["type"], shown["amount_minor"]) == ("expense", -1550)
    assert shown["category"]["name"] == "Comida"
    assert shown["account"]["name"] == "Itaú"
    assert "balance_after_minor" not in shown
    shown = await detail(income.id)
    assert (shown["type"], shown["amount_minor"]) == ("income", 90_000)
    shown = await detail(transfer.id)
    assert (shown["type"], shown["amount_minor"]) == ("transfer", 3000)
    assert (shown["from_account"]["name"], shown["to_account"]["name"]) == ("Itaú", "Efectivo")
    assert shown["account"] is None
    shown = await detail(adjustment.id)
    assert (shown["type"], shown["amount_minor"], shown["category"]) == ("adjustment", -250, None)


async def test_a_deleted_or_unknown_movement_has_no_detail(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    from datetime import UTC, datetime

    user_id, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    deleted = await insert_expense(
        session, space_id, user_id, account.id, category.id, 100, deleted_at=datetime.now(UTC)
    )

    for transaction_id in (deleted.id, uuid.uuid4()):
        response = await _get(api_client, space_id, f"/{transaction_id}")
        assert response.status_code == 404
        assert response.json() == TRANSACTION_NOT_FOUND


async def test_a_malformed_transaction_id_is_a_422(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    assert _issues(await _get(api_client, space_id, "/not-a-uuid")) == [
        ("uuid_parsing", ["path", "transaction_id"])
    ]


# with the writes --------------------------------------------------------------------------------


async def test_a_movement_created_by_the_api_is_listed_once_even_if_the_post_is_repeated(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    _, space_id = await make_user_and_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    body = {
        "type": "expense",
        "date": "2026-10-20",
        "account_id": str(account.id),
        "category_id": str(category.id),
        "amount_minor": 1550,
        "description": "Súper",
    }
    key = {"Idempotency-Key": str(uuid.uuid4())}
    first = await api_client.post(_url(space_id), json=body, headers={**COOKIE, **key})
    again = await api_client.post(_url(space_id), json=body, headers={**COOKIE, **key})
    assert first.status_code == again.status_code == 201

    listing = (await _get(api_client, space_id, month="2026-10")).json()
    summary = (await _get(api_client, space_id, "/summary", month="2026-10")).json()

    assert [item["id"] for item in listing["items"]] == [first.json()["id"]]
    assert listing["items"][0]["amount_minor"] == -1550
    assert summary == {
        "count": 1,
        "income_minor": 0,
        "expense_minor": 1550,
        "remaining_minor": -1550,
    }
    detail = await _get(api_client, space_id, f"/{first.json()['id']}")
    assert detail.json()["description"] == "Súper"

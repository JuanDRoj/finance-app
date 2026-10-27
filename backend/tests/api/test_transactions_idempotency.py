"""`Idempotency-Key` on `POST /spaces/{id}/transactions` through HTTP (KAN-93).

A double tap on "Guardar" sends the same request twice: with the same key the second one answers
with the movement of the first (201 and the same body) instead of creating another one. The same key
with another body is a 409 `idempotency_key_reused`. Without the header nothing changes. The race
between two requests at the same time is in `test_transactions_idempotency_concurrent.py` and
`tests/db/test_transaction_idempotency_concurrency.py` (here the requests share one connection).
"""

import uuid
from typing import Any

from httpx import AsyncClient, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import create_app
from app.modules.transactions.models import Entry, IdempotencyKey, Transaction
from tests.fakes import FakeFirebaseAuth, make_identity
from tests.transactions_helpers import make_account, make_category, make_user_and_space

COOKIE = {"Cookie": "session=valid-cookie"}
SPACE_NOT_FOUND = {"detail": "Space not found", "code": "space_not_found"}
NOT_AUTHENTICATED = {"detail": "Not authenticated", "code": "not_authenticated"}
KEY = "0199a000-0000-4000-8000-00000000000a"
OTHER_KEY = "0199a000-0000-4000-8000-00000000000b"
DAY = "2026-10-20"
HEADER = "Idempotency-Key"


def _url(space_id: uuid.UUID) -> str:
    return f"/spaces/{space_id}/transactions"


def _sign_in_as(fake: FakeFirebaseAuth, uid: str) -> None:
    fake.session_identity = make_identity(uid=uid)


def _expense(account_id: uuid.UUID, category_id: uuid.UUID, **fields: Any) -> dict[str, Any]:
    return {
        "type": "expense",
        "date": DAY,
        "account_id": str(account_id),
        "category_id": str(category_id),
        "amount_minor": 1550,
        **fields,
    }


async def _post(
    client: AsyncClient,
    space_id: uuid.UUID,
    body: dict[str, Any],
    key: str | None = KEY,
    *,
    header: str = HEADER,
) -> Response:
    headers = dict(COOKIE) if key is None else {**COOKIE, header: key}
    return await client.post(_url(space_id), json=body, headers=headers)


async def _count(session: AsyncSession, model: type[Any]) -> int:
    return await session.scalar(select(func.count()).select_from(model)) or 0


async def _written(session: AsyncSession) -> tuple[int, int, int]:
    """Transactions, entries and keys: what a request may have left behind."""
    return (
        await _count(session, Transaction),
        await _count(session, Entry),
        await _count(session, IdempotencyKey),
    )


async def _balance(client: AsyncClient, space_id: uuid.UUID, account_id: uuid.UUID) -> int:
    response = await client.get(f"/spaces/{space_id}/accounts/{account_id}", headers=COOKIE)
    assert response.status_code == 200, response.text
    balance: int = response.json()["balance_minor"]
    return balance


class World:
    def __init__(self, space_id: uuid.UUID, account_id: uuid.UUID, category_id: uuid.UUID) -> None:
        self.space_id = space_id
        self.account_id = account_id
        self.category_id = category_id

    def expense(self, **fields: Any) -> dict[str, Any]:
        return _expense(self.account_id, self.category_id, **fields)


async def _world(
    session: AsyncSession, fake: FakeFirebaseAuth, uid: str = "uid-a", *, sign_in: bool = True
) -> World:
    _, space_id = await make_user_and_space(session, uid)
    if sign_in:
        _sign_in_as(fake, uid)
    account = await make_account(session, space_id)
    category = await make_category(session, space_id)
    return World(space_id, account.id, category.id)


# the same request twice -----------------------------------------------------------------------


async def test_the_same_post_twice_answers_the_same_movement_and_creates_one(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    world = await _world(session, fake_firebase)

    first = await _post(api_client, world.space_id, world.expense(description="Súper"))
    second = await _post(api_client, world.space_id, world.expense(description="Súper"))

    assert (first.status_code, second.status_code) == (201, 201)
    assert second.json() == first.json()
    assert uuid.UUID(first.json()["id"]).version == 7
    assert await _written(session) == (1, 1, 1)
    assert await _balance(api_client, world.space_id, world.account_id) == -1550  # changed once


async def test_a_replay_after_other_movements_still_returns_the_original_body(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    world = await _world(session, fake_firebase)
    first = await _post(api_client, world.space_id, world.expense())
    other = await _post(api_client, world.space_id, world.expense(amount_minor=700), OTHER_KEY)

    again = await _post(api_client, world.space_id, world.expense())

    assert (other.status_code, again.status_code) == (201, 201)
    assert again.json() == first.json()
    assert await _written(session) == (2, 2, 2)
    assert await _balance(api_client, world.space_id, world.account_id) == -2250


async def test_the_header_name_and_the_uuid_can_be_spelled_differently(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    world = await _world(session, fake_firebase)

    first = await _post(api_client, world.space_id, world.expense(), KEY)
    shouted = await _post(api_client, world.space_id, world.expense(), KEY.upper())
    lower = await _post(api_client, world.space_id, world.expense(), KEY, header="idempotency-key")
    compact = await _post(api_client, world.space_id, world.expense(), KEY.replace("-", ""))

    assert [r.status_code for r in (first, shouted, lower, compact)] == [201, 201, 201, 201]
    assert {r.text for r in (first, shouted, lower, compact)} == {first.text}
    assert await _written(session) == (1, 1, 1)


async def test_another_spelling_of_the_same_body_is_still_the_same_request(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    world = await _world(session, fake_firebase)
    first = await _post(api_client, world.space_id, world.expense(description="Súper"))

    again = await _post(api_client, world.space_id, world.expense(description="  Súper "))

    assert (again.status_code, again.json()) == (201, first.json())
    assert await _written(session) == (1, 1, 1)


async def test_another_key_with_the_same_body_is_another_movement(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    world = await _world(session, fake_firebase)

    first = await _post(api_client, world.space_id, world.expense(), KEY)
    second = await _post(api_client, world.space_id, world.expense(), OTHER_KEY)

    assert first.json()["id"] != second.json()["id"]
    assert await _written(session) == (2, 2, 2)


# the same key with another body --------------------------------------------------------------


async def test_the_same_key_with_another_body_is_a_409_with_a_stable_code_and_writes_nothing(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    world = await _world(session, fake_firebase)
    first = await _post(api_client, world.space_id, world.expense())

    refused = await _post(api_client, world.space_id, world.expense(amount_minor=1551))

    assert first.status_code == 201
    assert refused.status_code == 409
    assert refused.json() == {
        "detail": "This Idempotency-Key was already used with a different request body",
        "code": "idempotency_key_reused",
    }
    assert await _written(session) == (1, 1, 1)
    assert await _balance(api_client, world.space_id, world.account_id) == -1550


async def test_after_the_409_the_original_request_still_replays(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    world = await _world(session, fake_firebase)
    first = await _post(api_client, world.space_id, world.expense())
    await _post(api_client, world.space_id, world.expense(amount_minor=1551))

    again = await _post(api_client, world.space_id, world.expense())

    assert (again.status_code, again.json()) == (201, first.json())


# without the header: as before ---------------------------------------------------------------


async def test_without_the_header_two_identical_posts_create_two_movements(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    world = await _world(session, fake_firebase)

    first = await _post(api_client, world.space_id, world.expense(), None)
    second = await _post(api_client, world.space_id, world.expense(), None)

    assert (first.status_code, second.status_code) == (201, 201)
    assert first.json()["id"] != second.json()["id"]
    assert await _written(session) == (2, 2, 0)
    assert await _balance(api_client, world.space_id, world.account_id) == -3100


# a failed request does not use the key -------------------------------------------------------


async def test_a_422_does_not_use_the_key_so_the_corrected_request_can_reuse_it(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    world = await _world(session, fake_firebase)
    archived = await make_account(session, world.space_id, name="Vieja", archived=True)
    wrong = _expense(archived.id, world.category_id)

    refused = await _post(api_client, world.space_id, wrong)
    fixed = await _post(api_client, world.space_id, world.expense())
    again = await _post(api_client, world.space_id, world.expense())

    assert refused.status_code == 422
    assert refused.json()["detail"][0]["type"] == "account_archived"
    assert await _count(session, IdempotencyKey) == 1  # only the one of the successful request
    assert (fixed.status_code, again.status_code) == (201, 201)
    assert again.json() == fixed.json()
    assert await _written(session) == (1, 1, 1)


async def test_a_body_that_fails_validation_does_not_use_the_key(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    world = await _world(session, fake_firebase)

    refused = await _post(api_client, world.space_id, world.expense(amount_minor=-5))
    created = await _post(api_client, world.space_id, world.expense())

    assert (refused.status_code, created.status_code) == (422, 201)
    assert await _written(session) == (1, 1, 1)


# the header ----------------------------------------------------------------------------------


async def test_a_header_that_is_not_a_uuid_is_a_422_on_the_header_and_writes_nothing(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    world = await _world(session, fake_firebase)

    for value in ("not-a-uuid", "", "1234"):
        response = await _post(api_client, world.space_id, world.expense(), value)

        assert response.status_code == 422, value
        [issue] = response.json()["detail"]
        assert (issue["type"], issue["loc"]) == ("uuid_parsing", ["header", HEADER])
    assert await _written(session) == (0, 0, 0)


# authentication and IDOR ---------------------------------------------------------------------


async def test_a_post_with_a_key_and_without_a_session_is_a_401(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    world = await _world(session, fake_firebase, sign_in=False)

    response = await api_client.post(
        _url(world.space_id), json=world.expense(), headers={HEADER: KEY}
    )

    assert (response.status_code, response.json()) == (401, NOT_AUTHENTICATED)
    assert await _written(session) == (0, 0, 0)


async def test_user_b_cannot_replay_the_key_of_user_a_in_the_space_of_user_a(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    world_a = await _world(session, fake_firebase, "uid-a")
    first = await _post(api_client, world_a.space_id, world_a.expense(description="Secreto"))
    await make_user_and_space(session, "uid-b")
    _sign_in_as(fake_firebase, "uid-b")

    same_body = await _post(api_client, world_a.space_id, world_a.expense(description="Secreto"))
    other_body = await _post(api_client, world_a.space_id, world_a.expense(amount_minor=1))
    bad_header = await _post(api_client, world_a.space_id, world_a.expense(), "not-a-uuid")

    assert first.status_code == 201
    for response in (same_body, other_body, bad_header):
        assert (response.status_code, response.json()) == (404, SPACE_NOT_FOUND)
        assert "Secreto" not in response.text
    assert await _written(session) == (1, 1, 1)


async def test_user_b_in_their_own_space_with_the_same_key_gets_their_own_movement(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    world_a = await _world(session, fake_firebase, "uid-a")
    first = await _post(api_client, world_a.space_id, world_a.expense(description="De A"))
    world_b = await _world(session, fake_firebase, "uid-b")  # signs in as B

    theirs = await _post(api_client, world_b.space_id, world_b.expense(amount_minor=999))
    replay_b = await _post(api_client, world_b.space_id, world_b.expense(amount_minor=999))

    assert (first.status_code, theirs.status_code, replay_b.status_code) == (201, 201, 201)
    assert theirs.json()["id"] != first.json()["id"]
    assert [e["amount_minor"] for e in theirs.json()["entries"]] == [-999]
    assert replay_b.json() == theirs.json()
    assert await _written(session) == (2, 2, 2)
    _sign_in_as(fake_firebase, "uid-a")
    assert (
        await _post(api_client, world_a.space_id, world_a.expense(description="De A"))
    ).json() == (first.json())


# the contract --------------------------------------------------------------------------------


def test_openapi_declares_the_optional_header_and_the_409() -> None:
    operation = create_app().openapi()["paths"]["/spaces/{space_id}/transactions"]["post"]

    [parameter] = [p for p in operation["parameters"] if p["in"] == "header"]
    assert parameter["name"] == HEADER
    assert parameter["required"] is False
    assert {"type": "string", "format": "uuid"} in parameter["schema"]["anyOf"]
    assert parameter["description"]
    assert operation["responses"]["409"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ErrorResponse"
    }
    assert "201" in operation["responses"]

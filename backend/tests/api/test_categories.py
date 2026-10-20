import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.spaces import service as spaces_service
from app.modules.users import service as users_service
from tests.fakes import FakeFirebaseAuth, make_identity

COOKIE = {"Cookie": "session=valid-cookie"}
ORIGIN = {"Origin": "http://localhost:3000"}
SPACE_NOT_FOUND = {"detail": "Space not found", "code": "space_not_found"}
CATEGORY_NOT_FOUND = {"detail": "Category not found", "code": "category_not_found"}
NOT_AUTHENTICATED = {"detail": "Not authenticated", "code": "not_authenticated"}
PUBLIC_FIELDS = {"id", "parent_id", "name", "kind", "icon", "archived_at"}


async def _user_with_space(session: AsyncSession, uid: str) -> uuid.UUID:
    user = await users_service.upsert_user(
        session, firebase_uid=uid, email=f"{uid}@example.com", display_name=None
    )
    await spaces_service.ensure_personal_space(session, user.id, "America/Montevideo")
    [space] = await spaces_service.list_spaces(session, user.id)
    return space.id


def _sign_in_as(fake: FakeFirebaseAuth, uid: str) -> None:
    fake.session_identity = make_identity(uid=uid)


def _url(space_id: uuid.UUID, category_id: uuid.UUID | str | None = None, action: str = "") -> str:
    base = f"/spaces/{space_id}/categories"
    if category_id is None:
        return base
    return f"{base}/{category_id}" + (f"/{action}" if action else "")


async def _post(client: AsyncClient, space_id: uuid.UUID, **body: Any) -> dict[str, Any]:
    payload = {"name": "Comida", "kind": "expense", "icon": "fork-knife", **body}
    response = await client.post(_url(space_id), json=payload, headers=COOKIE)
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


async def _list(
    client: AsyncClient, space_id: uuid.UUID, *, include_archived: bool = False
) -> list[dict[str, Any]]:
    response = await client.get(
        _url(space_id), params={"include_archived": str(include_archived).lower()}, headers=COOKIE
    )
    assert response.status_code == 200, response.text
    listed: list[dict[str, Any]] = response.json()
    return listed


async def _archive(client: AsyncClient, space_id: uuid.UUID, category_id: str) -> dict[str, Any]:
    response = await client.post(_url(space_id, category_id, "archive"), headers=COOKIE)
    assert response.status_code == 200, response.text
    archived: dict[str, Any] = response.json()
    return archived


# POST ---------------------------------------------------------------------------------------


async def test_create_a_main_category(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.post(
        _url(space_id),
        json={"name": "  Mascotas ", "kind": "expense", "icon": "paw-print"},
        headers=COOKIE,
    )

    assert response.status_code == 201
    body = response.json()
    assert uuid.UUID(body.pop("id")).version == 7
    assert body == {
        "parent_id": None,
        "name": "Mascotas",
        "kind": "expense",
        "icon": "paw-print",
        "archived_at": None,
    }


async def test_create_a_subcategory(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    main = await _post(api_client, space_id)

    sub = await _post(
        api_client, space_id, name="Supermercado", icon="shopping-cart", parent_id=main["id"]
    )

    assert (sub["parent_id"], sub["kind"]) == (main["id"], "expense")


async def test_create_an_income_category(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    body = await _post(api_client, space_id, name="Sueldo", kind="income", icon="money")

    assert body["kind"] == "income"


async def test_a_created_category_shows_up_in_the_list(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    created = await _post(api_client, space_id)

    assert await _list(api_client, space_id) == [created]


@pytest.mark.parametrize(
    ("body", "error_type", "loc"),
    [
        ({"name": ""}, "string_too_short", ["body", "name"]),
        ({"name": "   "}, "string_too_short", ["body", "name"]),
        ({"name": "a" * 81}, "string_too_long", ["body", "name"]),
        ({"kind": "transfer"}, "literal_error", ["body", "kind"]),
        ({"icon": "rocket"}, "literal_error", ["body", "icon"]),
        ({"icon": "ForkKnife"}, "literal_error", ["body", "icon"]),
        ({"parent_id": "not-a-uuid"}, "uuid_parsing", ["body", "parent_id"]),
        ({"space_id": str(uuid.uuid4())}, "extra_forbidden", ["body", "space_id"]),
        ({"archived_at": "2026-01-01T00:00:00Z"}, "extra_forbidden", ["body", "archived_at"]),
    ],
)
async def test_create_rejects_invalid_bodies_with_a_422_on_the_offending_field(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    body: dict[str, Any],
    error_type: str,
    loc: list[str],
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.post(
        _url(space_id),
        json={"name": "Comida", "kind": "expense", "icon": "fork-knife", **body},
        headers=COOKIE,
    )

    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert (error["type"], error["loc"]) == (error_type, loc)
    assert await _list(api_client, space_id) == []


@pytest.mark.parametrize("missing", ["name", "kind", "icon"])
async def test_create_requires_the_name_the_kind_and_the_icon(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, missing: str
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    body = {"name": "Comida", "kind": "expense", "icon": "fork-knife"}
    del body[missing]

    response = await api_client.post(_url(space_id), json=body, headers=COOKIE)

    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert (error["type"], error["loc"]) == ("missing", ["body", missing])


async def test_create_without_a_body_is_a_422(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    assert (await api_client.post(_url(space_id), headers=COOKIE)).status_code == 422


async def test_a_third_level_is_a_422_on_the_parent(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    main = await _post(api_client, space_id)
    sub = await _post(api_client, space_id, name="Supermercado", parent_id=main["id"])

    response = await api_client.post(
        _url(space_id),
        json={"name": "Marca", "kind": "expense", "icon": "tag", "parent_id": sub["id"]},
        headers=COOKIE,
    )

    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert (error["type"], error["loc"]) == ("category_parent_not_main", ["body", "parent_id"])
    assert len(await _list(api_client, space_id)) == 2


async def test_a_subcategory_of_a_different_kind_is_a_422_on_the_kind(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    main = await _post(api_client, space_id)

    response = await api_client.post(
        _url(space_id),
        json={"name": "Sueldo", "kind": "income", "icon": "money", "parent_id": main["id"]},
        headers=COOKIE,
    )

    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert (error["type"], error["loc"]) == ("category_kind_mismatch", ["body", "kind"])
    assert len(await _list(api_client, space_id)) == 1


async def test_a_parent_that_does_not_exist_is_a_422_on_the_parent(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.post(
        _url(space_id),
        json={
            "name": "Hija",
            "kind": "expense",
            "icon": "tag",
            "parent_id": str(uuid.uuid4()),
        },
        headers=COOKIE,
    )

    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert (error["type"], error["loc"]) == ("category_parent_not_found", ["body", "parent_id"])


async def test_a_subcategory_under_an_archived_main_is_a_422_on_the_parent(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    main = await _post(api_client, space_id)
    await _archive(api_client, space_id, main["id"])

    response = await api_client.post(
        _url(space_id),
        json={"name": "Hija", "kind": "expense", "icon": "tag", "parent_id": main["id"]},
        headers=COOKIE,
    )

    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert (error["type"], error["loc"]) == ("category_parent_archived", ["body", "parent_id"])


async def test_a_name_already_used_is_a_409_and_creates_nothing(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    await _post(api_client, space_id, name="Comida")

    response = await api_client.post(
        _url(space_id),
        json={"name": " comida ", "kind": "expense", "icon": "tag"},
        headers=COOKIE,
    )

    assert response.status_code == 409
    assert response.json()["code"] == "category_name_taken"
    assert set(response.json()) == {"detail", "code"}
    assert len(await _list(api_client, space_id)) == 1


async def test_a_subcategory_name_already_used_under_the_same_main_is_a_409(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    main = await _post(api_client, space_id)
    await _post(api_client, space_id, name="Supermercado", parent_id=main["id"])

    response = await api_client.post(
        _url(space_id),
        json={
            "name": "Supermercado",
            "kind": "expense",
            "icon": "tag",
            "parent_id": main["id"],
        },
        headers=COOKIE,
    )

    assert response.status_code == 409
    assert response.json()["code"] == "category_name_taken"


async def test_the_name_of_an_archived_category_is_still_taken(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    old = await _post(api_client, space_id, name="Ocio")
    await _archive(api_client, space_id, old["id"])

    response = await api_client.post(
        _url(space_id), json={"name": "Ocio", "kind": "expense", "icon": "tag"}, headers=COOKIE
    )

    assert response.status_code == 409
    assert response.json()["code"] == "category_name_taken"


# GET list -----------------------------------------------------------------------------------


async def test_list_is_empty_without_categories(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.get(_url(space_id), headers=COOKIE)

    assert response.status_code == 200
    assert response.json() == []


async def test_list_is_flat_with_the_parent_id_and_in_creation_order(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    zeta = await _post(api_client, space_id, name="Zeta")
    alfa = await _post(api_client, space_id, name="Alfa", kind="income", icon="money")
    child = await _post(api_client, space_id, name="Hija", parent_id=zeta["id"])

    listed = await _list(api_client, space_id)

    assert [c["name"] for c in listed] == ["Zeta", "Alfa", "Hija"]
    assert [c["parent_id"] for c in listed] == [None, None, zeta["id"]]
    assert listed == [zeta, alfa, child]
    assert all(set(c) == PUBLIC_FIELDS for c in listed)


async def test_list_hides_the_archived_categories_by_default(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    active = await _post(api_client, space_id, name="Activa")
    old = await _post(api_client, space_id, name="Vieja")
    await _archive(api_client, space_id, old["id"])

    response = await api_client.get(_url(space_id), headers=COOKIE)

    assert [c["id"] for c in response.json()] == [active["id"]]


async def test_list_can_include_the_archived_categories(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    await _post(api_client, space_id, name="Activa")
    old = await _post(api_client, space_id, name="Vieja")
    await _archive(api_client, space_id, old["id"])

    listed = await _list(api_client, space_id, include_archived=True)

    assert [(c["name"], c["archived_at"] is not None) for c in listed] == [
        ("Activa", False),
        ("Vieja", True),
    ]


async def test_list_rejects_a_malformed_include_archived(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.get(
        _url(space_id), params={"include_archived": "maybe"}, headers=COOKIE
    )

    assert response.status_code == 422


async def test_the_first_login_gives_the_new_user_the_34_default_categories(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth
) -> None:
    fake_firebase.identity = make_identity(uid="uid-new", email="new@example.com")
    login = await api_client.post(
        "/auth/session",
        json={"id_token": "id-token-123", "timezone": "America/Montevideo"},
        headers=ORIGIN,
    )
    assert login.status_code == 204
    _sign_in_as(fake_firebase, "uid-new")
    [space] = (await api_client.get("/spaces", headers=COOKIE)).json()

    listed = await _list(api_client, space["id"])

    assert len(listed) == 34
    assert [c["name"] for c in listed if c["parent_id"] is None][:5] == [
        "Comida",
        "Transporte",
        "Hogar",
        "Salud",
        "Ocio",
    ]
    assert all(c["archived_at"] is None for c in listed)
    again = await api_client.post(
        "/auth/session",
        json={"id_token": "id-token-123", "timezone": "America/Montevideo"},
        headers=ORIGIN,
    )
    assert again.status_code == 204
    assert len(await _list(api_client, space["id"])) == 34


# PATCH --------------------------------------------------------------------------------------


async def test_patch_renames_a_category_and_changes_its_icon_and_the_change_persists(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    created = await _post(api_client, space_id)

    response = await api_client.patch(
        _url(space_id, created["id"]),
        json={"name": " Alimentos ", "icon": "basket"},
        headers=COOKIE,
    )

    assert response.status_code == 200
    assert response.json() == {**created, "name": "Alimentos", "icon": "basket"}
    assert await _list(api_client, space_id) == [response.json()]


async def test_patch_with_only_the_icon_keeps_the_name(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    created = await _post(api_client, space_id)

    response = await api_client.patch(
        _url(space_id, created["id"]), json={"icon": "tag"}, headers=COOKIE
    )

    assert response.json() == {**created, "icon": "tag"}


async def test_an_empty_patch_returns_the_category_unchanged(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    created = await _post(api_client, space_id)

    response = await api_client.patch(_url(space_id, created["id"]), json={}, headers=COOKIE)

    assert response.status_code == 200
    assert response.json() == created


async def test_patch_can_rename_an_archived_category(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    created = await _post(api_client, space_id, name="Vieja")
    await _archive(api_client, space_id, created["id"])

    response = await api_client.patch(
        _url(space_id, created["id"]), json={"name": "Nueva"}, headers=COOKIE
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Nueva"
    assert response.json()["archived_at"] is not None


@pytest.mark.parametrize("field", ["kind", "parent_id", "archived_at", "space_id", "id"])
async def test_patch_does_not_accept_the_kind_the_parent_or_other_fields(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, field: str
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    created = await _post(api_client, space_id)

    response = await api_client.patch(
        _url(space_id, created["id"]), json={field: "income"}, headers=COOKIE
    )

    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert (error["type"], error["loc"]) == ("extra_forbidden", ["body", field])
    assert await _list(api_client, space_id) == [created]


@pytest.mark.parametrize("field", ["name", "icon"])
async def test_patch_rejects_an_explicit_null(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, field: str
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    created = await _post(api_client, space_id)

    response = await api_client.patch(
        _url(space_id, created["id"]), json={field: None}, headers=COOKIE
    )

    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert (error["type"], error["loc"]) == ("null_not_allowed", ["body", field])


@pytest.mark.parametrize(
    ("body", "error_type", "loc"),
    [
        ({"name": ""}, "string_too_short", ["body", "name"]),
        ({"name": "   "}, "string_too_short", ["body", "name"]),
        ({"name": "a" * 81}, "string_too_long", ["body", "name"]),
        ({"icon": "rocket"}, "literal_error", ["body", "icon"]),
    ],
)
async def test_patch_validates_the_name_and_the_icon(
    api_client: AsyncClient,
    fake_firebase: FakeFirebaseAuth,
    session: AsyncSession,
    body: dict[str, Any],
    error_type: str,
    loc: list[str],
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    created = await _post(api_client, space_id)

    response = await api_client.patch(_url(space_id, created["id"]), json=body, headers=COOKIE)

    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert (error["type"], error["loc"]) == (error_type, loc)


async def test_patch_to_a_taken_name_is_a_409_and_changes_nothing(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    await _post(api_client, space_id, name="Comida")
    other = await _post(api_client, space_id, name="Hogar", icon="house")

    response = await api_client.patch(
        _url(space_id, other["id"]), json={"name": "COMIDA", "icon": "tag"}, headers=COOKIE
    )

    assert response.status_code == 409
    assert response.json()["code"] == "category_name_taken"
    assert other in await _list(api_client, space_id)


async def test_patch_of_a_missing_category_is_404(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.patch(
        _url(space_id, uuid.uuid4()), json={"name": "x"}, headers=COOKIE
    )

    assert response.status_code == 404
    assert response.json() == CATEGORY_NOT_FOUND


# archive / unarchive ------------------------------------------------------------------------


async def test_archive_returns_the_archived_category(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    created = await _post(api_client, space_id)

    response = await api_client.post(_url(space_id, created["id"], "archive"), headers=COOKIE)

    assert response.status_code == 200
    body = response.json()
    assert body["archived_at"] is not None
    assert {**body, "archived_at": None} == created
    assert await _list(api_client, space_id) == []


async def test_archiving_a_main_archives_its_subcategories_in_the_list(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    main = await _post(api_client, space_id)
    await _post(api_client, space_id, name="Supermercado", parent_id=main["id"])
    other = await _post(api_client, space_id, name="Hogar", icon="house")

    await _archive(api_client, space_id, main["id"])

    assert [c["id"] for c in await _list(api_client, space_id)] == [other["id"]]
    everything = await _list(api_client, space_id, include_archived=True)
    assert [(c["name"], c["archived_at"] is not None) for c in everything] == [
        ("Comida", True),
        ("Supermercado", True),
        ("Hogar", False),
    ]


async def test_archiving_twice_returns_200_both_times_with_the_same_moment(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    created = await _post(api_client, space_id)

    first = await api_client.post(_url(space_id, created["id"], "archive"), headers=COOKIE)
    second = await api_client.post(_url(space_id, created["id"], "archive"), headers=COOKIE)

    assert (first.status_code, second.status_code) == (200, 200)
    assert second.json() == first.json()


async def test_unarchive_returns_the_category_active_again(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    created = await _post(api_client, space_id)
    await _archive(api_client, space_id, created["id"])

    response = await api_client.post(_url(space_id, created["id"], "unarchive"), headers=COOKIE)

    assert response.status_code == 200
    assert response.json() == created
    assert await _list(api_client, space_id) == [created]


async def test_unarchiving_a_main_restores_the_subcategories_archived_with_it(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    main = await _post(api_client, space_id)
    await _post(api_client, space_id, name="Supermercado", parent_id=main["id"])
    alone = await _post(api_client, space_id, name="Sola", parent_id=main["id"])
    await _archive(api_client, space_id, alone["id"])
    await _archive(api_client, space_id, main["id"])

    await api_client.post(_url(space_id, main["id"], "unarchive"), headers=COOKIE)

    assert [c["name"] for c in await _list(api_client, space_id)] == ["Comida", "Supermercado"]


async def test_unarchiving_a_subcategory_of_an_archived_main_is_a_409(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    main = await _post(api_client, space_id)
    sub = await _post(api_client, space_id, name="Supermercado", parent_id=main["id"])
    await _archive(api_client, space_id, main["id"])

    response = await api_client.post(_url(space_id, sub["id"], "unarchive"), headers=COOKIE)

    assert response.status_code == 409
    assert response.json()["code"] == "category_parent_archived"
    assert await _list(api_client, space_id) == []


@pytest.mark.parametrize("action", ["archive", "unarchive"])
async def test_archive_and_unarchive_of_a_missing_category_are_404(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, action: str
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    response = await api_client.post(_url(space_id, uuid.uuid4(), action), headers=COOKIE)

    assert response.status_code == 404
    assert response.json() == CATEGORY_NOT_FOUND


@pytest.mark.parametrize("action", ["archive", "unarchive"])
async def test_a_category_id_that_is_not_a_uuid_is_a_422(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, action: str
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")

    post = await api_client.post(_url(space_id, "not-a-uuid", action), headers=COOKIE)
    patch = await api_client.patch(_url(space_id, "not-a-uuid"), json={}, headers=COOKIE)

    assert (post.status_code, patch.status_code) == (422, 422)


@pytest.mark.parametrize("action", ["archive", "unarchive"])
async def test_archive_and_unarchive_cannot_be_called_with_get(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession, action: str
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    _sign_in_as(fake_firebase, "uid-a")
    created = await _post(api_client, space_id)

    response = await api_client.get(_url(space_id, created["id"], action), headers=COOKIE)

    assert response.status_code == 405
    assert await _list(api_client, space_id) == [created]


# 401 ----------------------------------------------------------------------------------------


async def test_every_category_route_without_a_session_is_a_401(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_id = await _user_with_space(session, "uid-a")
    category_id = uuid.uuid4()
    body = {"name": "x", "kind": "expense", "icon": "tag"}

    responses = [
        await api_client.get(_url(space_id)),
        await api_client.post(_url(space_id), json=body),
        await api_client.patch(_url(space_id, category_id), json={"name": "x"}),
        await api_client.post(_url(space_id, category_id, "archive")),
        await api_client.post(_url(space_id, category_id, "unarchive")),
    ]

    assert [r.status_code for r in responses] == [401] * 5
    assert all(r.json() == NOT_AUTHENTICATED for r in responses)
    assert not fake_firebase.called


# IDOR ---------------------------------------------------------------------------------------


async def test_user_b_gets_404_on_every_category_route_of_the_space_of_user_a(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_a = await _user_with_space(session, "uid-a")
    await _user_with_space(session, "uid-b")
    _sign_in_as(fake_firebase, "uid-a")
    category_a = await _post(api_client, space_a, name="De A")
    _sign_in_as(fake_firebase, "uid-b")
    body = {"name": "Intrusa", "kind": "expense", "icon": "tag"}

    responses = [
        await api_client.get(_url(space_a), headers=COOKIE),
        await api_client.get(_url(space_a), params={"include_archived": "true"}, headers=COOKIE),
        await api_client.post(_url(space_a), json=body, headers=COOKIE),
        await api_client.patch(_url(space_a, category_a["id"]), json={"name": "R"}, headers=COOKIE),
        await api_client.post(_url(space_a, category_a["id"], "archive"), headers=COOKIE),
        await api_client.post(_url(space_a, category_a["id"], "unarchive"), headers=COOKIE),
    ]

    assert [r.status_code for r in responses] == [404] * 6
    assert all(r.json() == SPACE_NOT_FOUND for r in responses)
    _sign_in_as(fake_firebase, "uid-a")
    assert await _list(api_client, space_a, include_archived=True) == [category_a]


async def test_a_category_of_space_a_is_a_404_inside_the_own_space_of_user_b(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    # B is a member of space B, so the membership guard passes: the 404 comes from the repository
    # filtering by space, which is what stops an id guessed from another space.
    space_a = await _user_with_space(session, "uid-a")
    space_b = await _user_with_space(session, "uid-b")
    _sign_in_as(fake_firebase, "uid-a")
    category_a = await _post(api_client, space_a, name="De A")
    _sign_in_as(fake_firebase, "uid-b")

    responses = [
        await api_client.patch(_url(space_b, category_a["id"]), json={"name": "R"}, headers=COOKIE),
        await api_client.post(_url(space_b, category_a["id"], "archive"), headers=COOKIE),
        await api_client.post(_url(space_b, category_a["id"], "unarchive"), headers=COOKIE),
    ]

    assert [r.status_code for r in responses] == [404] * 3
    assert all(r.json() == CATEGORY_NOT_FOUND for r in responses)
    _sign_in_as(fake_firebase, "uid-a")
    assert await _list(api_client, space_a, include_archived=True) == [category_a]


async def test_the_list_of_user_b_never_includes_the_categories_of_user_a(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_a = await _user_with_space(session, "uid-a")
    space_b = await _user_with_space(session, "uid-b")
    _sign_in_as(fake_firebase, "uid-a")
    category_a = await _post(api_client, space_a, name="De A")
    archived_a = await _post(api_client, space_a, name="Archivada de A")
    await _archive(api_client, space_a, archived_a["id"])
    _sign_in_as(fake_firebase, "uid-b")
    category_b = await _post(api_client, space_b, name="De B")

    default = await _list(api_client, space_b)
    everything = await _list(api_client, space_b, include_archived=True)

    assert [c["id"] for c in default] == [category_b["id"]]
    assert [c["id"] for c in everything] == [category_b["id"]]
    assert category_a["id"] not in str(everything)
    assert archived_a["id"] not in str(everything)


async def test_a_parent_of_space_a_in_a_post_of_user_b_is_the_same_422_as_a_missing_parent(
    api_client: AsyncClient, fake_firebase: FakeFirebaseAuth, session: AsyncSession
) -> None:
    space_a = await _user_with_space(session, "uid-a")
    space_b = await _user_with_space(session, "uid-b")
    _sign_in_as(fake_firebase, "uid-a")
    parent_a = await _post(api_client, space_a, name="De A")
    _sign_in_as(fake_firebase, "uid-b")

    def body(parent_id: str) -> dict[str, str]:
        return {"name": "Hija", "kind": "expense", "icon": "tag", "parent_id": parent_id}

    foreign = await api_client.post(_url(space_b), json=body(parent_a["id"]), headers=COOKIE)
    missing = await api_client.post(_url(space_b), json=body(str(uuid.uuid4())), headers=COOKIE)

    assert (foreign.status_code, missing.status_code) == (422, 422)
    assert foreign.json() == missing.json()
    assert await _list(api_client, space_b, include_archived=True) == []

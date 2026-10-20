import uuid
from typing import Any

import pytest
from pydantic import ValidationError

from app.modules.categories.schemas import CategoryCreate, CategoryRead, CategoryUpdate


def _create(**fields: Any) -> CategoryCreate:
    return CategoryCreate.model_validate(
        {"name": "Comida", "kind": "expense", "icon": "fork-knife", **fields}
    )


def _errors(model: type[CategoryCreate] | type[CategoryUpdate], data: dict[str, Any]) -> list[Any]:
    with pytest.raises(ValidationError) as caught:
        model.model_validate(data)
    return [(e["type"], e["loc"]) for e in caught.value.errors()]


# CategoryCreate -----------------------------------------------------------------------------


def test_create_accepts_a_main_category() -> None:
    category = _create()

    assert (category.name, category.kind, category.icon) == ("Comida", "expense", "fork-knife")
    assert category.parent_id is None


def test_create_accepts_a_subcategory_with_a_parent() -> None:
    parent_id = uuid.uuid4()

    assert _create(parent_id=str(parent_id)).parent_id == parent_id


def test_create_trims_the_name() -> None:
    assert _create(name="  Supermercado ").name == "Supermercado"


@pytest.mark.parametrize("name", ["", " ", "   "])
def test_create_rejects_an_empty_or_blank_name(name: str) -> None:
    assert _errors(CategoryCreate, {"name": name, "kind": "expense", "icon": "tag"}) == [
        ("string_too_short", ("name",))
    ]


def test_create_accepts_a_name_of_80_characters_and_rejects_81() -> None:
    assert len(_create(name="a" * 80).name) == 80
    assert _errors(CategoryCreate, {"name": "a" * 81, "kind": "expense", "icon": "tag"}) == [
        ("string_too_long", ("name",))
    ]


def test_create_rejects_a_name_that_is_not_a_string() -> None:
    assert _errors(CategoryCreate, {"name": 5, "kind": "expense", "icon": "tag"}) == [
        ("string_type", ("name",))
    ]


@pytest.mark.parametrize("kind", ["transfer", "adjustment", "Expense", "", None])
def test_create_rejects_a_kind_that_is_not_expense_or_income(kind: object) -> None:
    assert _errors(CategoryCreate, {"name": "x", "kind": kind, "icon": "tag"}) == [
        ("literal_error", ("kind",))
    ]


@pytest.mark.parametrize("icon", ["rocket", "Fork-Knife", "ForkKnife", "fork_knife", "", None])
def test_create_rejects_an_icon_that_is_not_in_the_fixed_list(icon: object) -> None:
    assert _errors(CategoryCreate, {"name": "x", "kind": "expense", "icon": icon}) == [
        ("literal_error", ("icon",))
    ]


@pytest.mark.parametrize("field", ["name", "kind", "icon"])
def test_create_requires_the_name_the_kind_and_the_icon(field: str) -> None:
    body = {"name": "x", "kind": "expense", "icon": "tag"}
    del body[field]

    assert _errors(CategoryCreate, body) == [("missing", (field,))]


def test_create_rejects_a_parent_id_that_is_not_a_uuid() -> None:
    errors = _errors(
        CategoryCreate,
        {"name": "x", "kind": "expense", "icon": "tag", "parent_id": "not-a-uuid"},
    )

    assert errors == [("uuid_parsing", ("parent_id",))]


@pytest.mark.parametrize("field", ["space_id", "archived_at", "id", "is_main"])
def test_create_rejects_fields_it_does_not_declare(field: str) -> None:
    errors = _errors(
        CategoryCreate, {"name": "x", "kind": "expense", "icon": "tag", field: "anything"}
    )

    assert errors == [("extra_forbidden", (field,))]


# CategoryUpdate -----------------------------------------------------------------------------


def test_update_accepts_the_name_and_the_icon() -> None:
    update = CategoryUpdate.model_validate({"name": " Mercado ", "icon": "basket"})

    assert update.model_dump(exclude_unset=True) == {"name": "Mercado", "icon": "basket"}


def test_update_with_no_fields_changes_nothing() -> None:
    assert CategoryUpdate.model_validate({}).model_dump(exclude_unset=True) == {}


@pytest.mark.parametrize("field", ["kind", "parent_id", "archived_at", "space_id", "id"])
def test_update_does_not_accept_the_kind_the_parent_or_other_fields(field: str) -> None:
    assert _errors(CategoryUpdate, {field: "expense"}) == [("extra_forbidden", (field,))]


@pytest.mark.parametrize("field", ["name", "icon"])
def test_update_rejects_an_explicit_null(field: str) -> None:
    assert _errors(CategoryUpdate, {field: None}) == [("null_not_allowed", (field,))]


def test_update_validates_the_name_and_the_icon() -> None:
    assert _errors(CategoryUpdate, {"name": "  "}) == [("string_too_short", ("name",))]
    assert _errors(CategoryUpdate, {"icon": "rocket"}) == [("literal_error", ("icon",))]


# CategoryRead -------------------------------------------------------------------------------


def test_read_exposes_only_the_public_fields() -> None:
    assert set(CategoryRead.model_fields) == {
        "id",
        "parent_id",
        "name",
        "kind",
        "icon",
        "archived_at",
    }

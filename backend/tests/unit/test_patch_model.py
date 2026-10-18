"""`PatchModel`: the base of every PATCH body (null handling and the contract it publishes)."""

import importlib
import pkgutil
from typing import Annotated, Any, Literal, Optional, Union

import pytest
from pydantic import Field, ValidationError

import app.modules
from app.core.schemas import PatchModel, admits_none, unset


class _Patch(PatchModel):
    name: str = unset()
    count: Annotated[int, Field(strict=True, ge=1)] = unset()
    # Declared as nullable on purpose: this one field can be cleared.
    nickname: str | None = None
    limit: Annotated[int, Field(ge=1)] | None = Field(default=None)


def _errors(data: dict[str, Any]) -> list[Any]:
    with pytest.raises(ValidationError) as exc:
        _Patch.model_validate(data)
    return [(e["type"], e["loc"]) for e in exc.value.errors()]


def test_an_empty_patch_is_valid_and_sets_nothing() -> None:
    patch = _Patch.model_validate({})

    assert patch.model_dump(exclude_unset=True) == {}
    assert patch.model_fields_set == set()


def test_only_the_fields_that_were_sent_are_set() -> None:
    patch = _Patch.model_validate({"name": "x", "count": 3})

    assert patch.model_dump(exclude_unset=True) == {"name": "x", "count": 3}


@pytest.mark.parametrize("field", ["name", "count"])
def test_null_on_a_field_that_is_not_nullable_is_one_error_on_that_field(field: str) -> None:
    assert _errors({field: None}) == [("null_not_allowed", (field,))]


@pytest.mark.parametrize("field", ["nickname", "limit"])
def test_null_on_a_nullable_field_is_accepted_and_counts_as_sent(field: str) -> None:
    patch = _Patch.model_validate({field: None})

    assert patch.model_dump(exclude_unset=True) == {field: None}


def test_a_nullable_field_still_validates_its_own_constraints() -> None:
    assert _errors({"limit": 0}) == [("greater_than_equal", ("limit",))]


def test_a_value_that_is_not_null_gets_the_normal_error_on_the_field() -> None:
    assert _errors({"count": 0, "name": 5}) == [
        ("string_type", ("name",)),
        ("greater_than_equal", ("count",)),
    ]


def test_several_null_fields_give_one_error_each() -> None:
    assert _errors({"name": None, "count": None}) == [
        ("null_not_allowed", ("name",)),
        ("null_not_allowed", ("count",)),
    ]


def test_unknown_fields_are_rejected_like_in_any_input_model() -> None:
    assert _errors({"surprise": 1}) == [("extra_forbidden", ("surprise",))]


def test_defaults_are_not_validated_so_an_omitted_field_is_not_an_error() -> None:
    patch = _Patch.model_validate({"nickname": "x"})

    # An unsent field reads as None whatever its type says: a PATCH is read only with
    # `model_dump(exclude_unset=True)`.
    assert patch.name is None
    assert patch.model_dump(exclude_unset=True) == {"nickname": "x"}


# admits_none --------------------------------------------------------------------------------

type _NullableAlias = int | None
type _PlainAlias = int


@pytest.mark.parametrize(
    "annotation",
    [
        None,
        type(None),
        Any,
        str | None,
        Optional[str],  # noqa: UP045 (the legacy spelling is the point of the case)
        Union[str, None],  # noqa: UP007
        Annotated[str | None, Field(max_length=3)],
        Annotated[int, Field(ge=1)] | None,
        Annotated[Annotated[int, Field(ge=1)] | None, Field(default=None)],
        Literal["a", None],
        int | str | None,
        _NullableAlias,
    ],
)
def test_admits_none_is_true_when_the_annotation_allows_null(annotation: object) -> None:
    assert admits_none(annotation) is True


@pytest.mark.parametrize(
    "annotation",
    [
        str,
        int,
        Annotated[str, Field(max_length=3)],
        Annotated[Annotated[int, Field(ge=1)], Field(le=9)],
        int | str,
        Literal["a", "b"],
        list[int | None],
        _PlainAlias,
    ],
)
def test_admits_none_is_false_when_the_annotation_does_not_allow_null(annotation: object) -> None:
    assert admits_none(annotation) is False


# JSON schema --------------------------------------------------------------------------------


def schema_allows_null(schema: object) -> bool:
    """True if a JSON schema fragment accepts null anywhere (the `default` value is ignored)."""
    if isinstance(schema, list):
        return any(schema_allows_null(item) for item in schema)
    if not isinstance(schema, dict):
        return False
    kind = schema.get("type")
    if kind == "null" or (isinstance(kind, list) and "null" in kind):
        return True
    if schema.get("nullable") is True:
        return True
    return any(
        schema_allows_null(schema[key]) for key in ("anyOf", "oneOf", "allOf") if key in schema
    )


def test_the_json_schema_of_the_test_model_matches_what_the_validator_accepts() -> None:
    properties = _Patch.model_json_schema()["properties"]

    assert {name: schema_allows_null(p) for name, p in properties.items()} == {
        "name": False,
        "count": False,
        "nickname": True,
        "limit": True,
    }


def test_the_schema_helper_sees_null_in_every_shape_pydantic_uses() -> None:
    assert schema_allows_null({"anyOf": [{"type": "string"}, {"type": "null"}]})
    assert schema_allows_null({"type": ["string", "null"]})
    assert schema_allows_null({"type": "string", "nullable": True})
    assert not schema_allows_null({"type": "string", "default": None})


def _app_patch_models() -> list[type[PatchModel]]:
    """Every `PatchModel` subclass of the app, found by importing every `schemas` module."""
    for module in pkgutil.iter_modules(app.modules.__path__):
        if module.ispkg:
            try:
                importlib.import_module(f"app.modules.{module.name}.schemas")
            except ModuleNotFoundError as exc:
                if exc.name != f"app.modules.{module.name}.schemas":
                    raise

    found: list[type[PatchModel]] = []
    pending: list[type[PatchModel]] = list(PatchModel.__subclasses__())
    while pending:
        cls = pending.pop()
        pending.extend(cls.__subclasses__())
        if cls.__module__.startswith("app."):
            found.append(cls)
    return sorted(found, key=lambda c: c.__qualname__)


def test_every_patch_model_of_the_app_publishes_null_only_on_nullable_fields() -> None:
    models = _app_patch_models()

    assert models, "no PatchModel found: the test would pass without checking anything"
    assert "AccountUpdate" in {m.__name__ for m in models}
    for model in models:
        properties = model.model_json_schema()["properties"]
        for name, field in model.model_fields.items():
            published = schema_allows_null(properties[name])
            assert published == admits_none(field.annotation), f"{model.__name__}.{name}"


def test_every_patch_model_of_the_app_rejects_null_on_its_non_nullable_fields() -> None:
    for model in _app_patch_models():
        for name, field in model.model_fields.items():
            if admits_none(field.annotation):
                continue
            with pytest.raises(ValidationError) as exc:
                model.model_validate({name: None})
            assert [(e["type"], e["loc"]) for e in exc.value.errors()] == [
                ("null_not_allowed", (name,))
            ], f"{model.__name__}.{name}"


def test_every_patch_model_of_the_app_accepts_an_empty_body_and_sets_nothing() -> None:
    # Guards against `validate_default=True` (or a default validator) creeping into a PatchModel:
    # omitting a field must never be an error.
    for model in _app_patch_models():
        patch = model.model_validate({})

        assert patch.model_dump(exclude_unset=True) == {}, model.__name__
        assert patch.model_fields_set == set(), model.__name__


def test_the_models_defined_in_tests_are_not_part_of_the_app_check() -> None:
    assert _Patch not in _app_patch_models()

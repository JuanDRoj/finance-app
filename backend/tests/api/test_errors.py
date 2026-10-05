import io
import json

import pytest
from fastapi import FastAPI, HTTPException
from httpx import AsyncClient
from pydantic import BaseModel

from app.core.errors import (
    AppError,
    ConflictError,
    ErrorResponse,
    ForbiddenError,
    InvalidFieldError,
    NotFoundError,
    UnauthenticatedError,
)
from app.main import create_app


class _ForgotStatusError(AppError):
    """A subclass that forgot to declare its own status: it inherits the base's 500."""


class _Body(BaseModel):
    amount: int


def _add_error_routes(app: FastAPI) -> None:
    @app.get("/_test/not-found")
    async def not_found() -> None:
        raise NotFoundError("account_not_found", "Account not found")

    @app.get("/_test/conflict")
    async def conflict() -> None:
        raise ConflictError("account_has_balance", "Account has a non-zero balance")

    @app.get("/_test/unauthenticated")
    async def unauthenticated() -> None:
        raise UnauthenticatedError("not_authenticated", "Not authenticated")

    @app.get("/_test/forbidden")
    async def forbidden() -> None:
        raise ForbiddenError("origin_not_allowed", "Origin not allowed")

    @app.get("/_test/invalid-field")
    async def invalid_field() -> None:
        raise InvalidFieldError(
            ["body", "category_id"], "category_kind_mismatch", "Category kind does not match"
        )

    @app.get("/_test/legacy-http-exception")
    async def legacy() -> None:
        raise HTTPException(status_code=409, detail="legacy conflict")

    @app.get("/_test/base-app-error")
    async def base_app_error() -> None:
        raise AppError("some_problem", "Some internal problem")

    @app.get("/_test/server-error-subclass")
    async def server_error_subclass() -> None:
        raise _ForgotStatusError("forgot_status", "Subclass that never set its status")

    @app.post("/_test/validated")
    async def validated(body: _Body) -> None:
        return None


@pytest.mark.parametrize(
    ("path", "status", "body"),
    [
        (
            "/_test/not-found",
            404,
            {"detail": "Account not found", "code": "account_not_found"},
        ),
        (
            "/_test/conflict",
            409,
            {"detail": "Account has a non-zero balance", "code": "account_has_balance"},
        ),
        (
            "/_test/unauthenticated",
            401,
            {"detail": "Not authenticated", "code": "not_authenticated"},
        ),
        (
            "/_test/forbidden",
            403,
            {"detail": "Origin not allowed", "code": "origin_not_allowed"},
        ),
    ],
)
async def test_app_errors_use_the_single_error_format(
    app: FastAPI, client: AsyncClient, path: str, status: int, body: dict[str, str]
) -> None:
    _add_error_routes(app)

    response = await client.get(path)

    assert response.status_code == status
    assert response.json() == body


def test_app_error_subclasses_carry_their_http_status() -> None:
    assert NotFoundError.status_code == 404
    assert ConflictError.status_code == 409
    assert UnauthenticatedError.status_code == 401
    assert ForbiddenError.status_code == 403
    assert issubclass(ForbiddenError, AppError)
    assert InvalidFieldError.status_code == 422
    assert issubclass(NotFoundError, AppError)
    assert issubclass(InvalidFieldError, AppError)


async def test_invalid_field_error_uses_the_fastapi_validation_format(
    app: FastAPI, client: AsyncClient
) -> None:
    _add_error_routes(app)

    response = await client.get("/_test/invalid-field")

    assert response.status_code == 422
    assert response.json() == {
        "detail": [
            {
                "type": "category_kind_mismatch",
                "loc": ["body", "category_id"],
                "msg": "Category kind does not match",
            }
        ]
    }


async def test_invalid_field_error_has_the_same_keys_as_a_pydantic_422(
    app: FastAPI, client: AsyncClient
) -> None:
    _add_error_routes(app)

    pydantic_entry = (await client.post("/_test/validated", json={})).json()["detail"][0]
    service_entry = (await client.get("/_test/invalid-field")).json()["detail"][0]

    assert {"type", "loc", "msg"} <= pydantic_entry.keys()
    assert {"type", "loc", "msg"} <= service_entry.keys()


async def test_pydantic_validation_error_stays_a_list_in_detail(
    app: FastAPI, client: AsyncClient
) -> None:
    _add_error_routes(app)

    response = await client.post("/_test/validated", json={"amount": "abc"})

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert isinstance(detail, list)
    assert detail[0]["loc"] == ["body", "amount"]


async def test_unknown_route_returns_the_single_error_format(client: AsyncClient) -> None:
    response = await client.get("/does-not-exist")

    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found", "code": "not_found"}


async def test_method_not_allowed_keeps_the_allow_header(client: AsyncClient) -> None:
    response = await client.post("/healthz")

    assert response.status_code == 405
    assert response.json() == {"detail": "Method Not Allowed", "code": "method_not_allowed"}
    assert "GET" in response.headers["allow"]


async def test_legacy_http_exception_is_converted_to_the_single_error_format(
    app: FastAPI, client: AsyncClient
) -> None:
    _add_error_routes(app)

    response = await client.get("/_test/legacy-http-exception")

    assert response.status_code == 409
    assert response.json() == {"detail": "legacy conflict", "code": "conflict"}


async def test_error_responses_carry_the_request_id(app: FastAPI, client: AsyncClient) -> None:
    _add_error_routes(app)

    for path in ("/_test/not-found", "/_test/invalid-field", "/does-not-exist"):
        response = await client.get(path, headers={"X-Request-ID": "rid-err"})
        assert response.headers["x-request-id"] == "rid-err"


async def test_expected_errors_are_not_logged_as_unhandled_exceptions(
    app: FastAPI, client: AsyncClient, log_stream: io.StringIO
) -> None:
    _add_error_routes(app)

    paths = (
        "/_test/not-found",
        "/_test/conflict",
        "/_test/unauthenticated",
        "/_test/forbidden",
        "/_test/invalid-field",
        "/nope",
    )
    for path in paths:
        await client.get(path)

    lines = [json.loads(line) for line in log_stream.getvalue().splitlines()]
    assert not [line for line in lines if "exception" in line]
    assert "unhandled_exception" not in {line["message"] for line in lines}


@pytest.mark.parametrize("path", ["/_test/base-app-error", "/_test/server-error-subclass"])
async def test_an_app_error_without_a_client_status_is_an_unexpected_500(
    app: FastAPI, client: AsyncClient, log_stream: io.StringIO, path: str
) -> None:
    _add_error_routes(app)

    response = await client.get(path, headers={"X-Request-ID": "rid-base"})

    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error", "code": "internal_error"}
    assert "some_problem" not in response.text
    assert "forgot_status" not in response.text
    assert response.headers["x-request-id"] == "rid-base"

    lines = [json.loads(line) for line in log_stream.getvalue().splitlines()]
    traces = [line for line in lines if "exception" in line]
    assert len(traces) == 1
    assert traces[0]["request_id"] == "rid-base"
    assert traces[0]["message"] == "unhandled_exception"
    assert "AppError" in traces[0]["exception"] or "_ForgotStatusError" in traces[0]["exception"]
    completed = next(line for line in lines if line["message"] == "request_completed")
    assert completed["status"] == 500


@pytest.mark.parametrize("loc", [("body", "category_id"), ["body", "category_id"]])
def test_invalid_field_error_accepts_a_tuple_or_a_list_as_loc(
    loc: tuple[str | int, ...] | list[str | int],
) -> None:
    error = InvalidFieldError(loc, "category_kind_mismatch", "Category kind does not match")

    assert error.loc == ["body", "category_id"]


def test_invalid_field_error_loc_can_mix_names_and_indexes() -> None:
    error = InvalidFieldError(("body", "entries", 0, "account_id"), "x", "y")

    assert error.loc == ["body", "entries", 0, "account_id"]


def test_invalid_field_error_rejects_a_string_loc() -> None:
    # A bare string would be split into characters: ["c", "a", "t", ...]. The `type: ignore` is
    # also the static check: mypy (warn_unused_ignores) fails if it ever stops rejecting a str.
    with pytest.raises(TypeError, match="loc"):
        InvalidFieldError("category_id", "x", "y")  # type: ignore[arg-type]


def test_error_response_schema_has_detail_and_code() -> None:
    assert set(ErrorResponse.model_fields) == {"detail", "code"}
    assert ErrorResponse(detail="x", code="y").model_dump() == {"detail": "x", "code": "y"}


def test_error_response_is_documented_in_the_openapi_when_a_route_uses_it() -> None:
    app = create_app()

    @app.get("/_test/documented", responses={404: {"model": ErrorResponse}})
    async def documented() -> str:
        return "ok"

    schema = app.openapi()["components"]["schemas"]["ErrorResponse"]
    assert set(schema["required"]) == {"detail", "code"}
    assert set(schema["properties"]) == {"detail", "code"}

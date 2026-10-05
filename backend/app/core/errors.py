"""One error format for every 4xx and 5xx response.

Services raise an `AppError` subclass; the handlers registered by `register_exception_handlers`
turn it into JSON. The client always gets `{"detail": "<English text>", "code": "<snake_case>"}`
(`ErrorResponse`), except for 422, which keeps the shape of FastAPI's own validation errors so
the frontend can mark the offending form field whether Pydantic or a service rejected it:

    {"detail": [{"type": "<code>", "loc": ["body", "field"], "msg": "<English text>"}]}

Unexpected errors (500) are not handled here but in `RequestIdMiddleware`
(`app/core/logging.py`), which uses `internal_error_response`. Never put a traceback, an SQL
statement or an exception message in a response; the `X-Request-ID` header is what lets someone
find the full error in the logs.
"""

import re
from collections.abc import Sequence
from http import HTTPStatus
from typing import ClassVar, cast

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException


class ErrorResponse(BaseModel):
    """Body of every error response except 422, for `responses={404: {"model": ErrorResponse}}`."""

    detail: str
    code: str


class AppError(Exception):
    """Base of the errors a service may raise. Raise a subclass, not this class."""

    status_code: ClassVar[int] = 500

    def __init__(self, code: str, detail: str) -> None:
        """`code` is a stable snake_case identifier (never renamed); `detail` is English text."""
        super().__init__(detail)
        self.code = code
        self.detail = detail


class NotFoundError(AppError):
    """The resource does not exist or is not in the caller's space (including "not a member")."""

    status_code = 404


class ConflictError(AppError):
    """The request clashes with the current state: duplicate, archive with balance, ..."""

    status_code = 409


class UnauthenticatedError(AppError):
    """No session, or an invalid or expired one."""

    status_code = 401


class InvalidFieldError(AppError):
    """Validation that needs the database (category of another kind, archived account, ...)."""

    status_code = 422

    def __init__(self, loc: Sequence[str | int], code: str, msg: str) -> None:
        super().__init__(code, msg)
        self.loc = list(loc)


def internal_error_response() -> JSONResponse:
    return JSONResponse(
        ErrorResponse(detail="Internal server error", code="internal_error").model_dump(),
        status_code=500,
    )


def _error_response(
    status_code: int, detail: str, code: str, headers: dict[str, str] | None = None
) -> JSONResponse:
    body = ErrorResponse(detail=detail, code=code).model_dump()
    return JSONResponse(body, status_code=status_code, headers=headers)


def _code_for_http_status(status_code: int) -> str:
    """`404` -> `not_found`, `405` -> `method_not_allowed` (the standard reason phrase)."""
    try:
        phrase = HTTPStatus(status_code).phrase
    except ValueError:
        return "http_error"
    return re.sub(r"[^a-z0-9]+", "_", phrase.lower()).strip("_")


# Starlette types every handler as `(Request, Exception)`, so each one narrows its own class
# (the registration below guarantees which one it receives).
async def _handle_app_error(_request: Request, exc: Exception) -> Response:
    error = cast(AppError, exc)
    return _error_response(error.status_code, error.detail, error.code)


async def _handle_invalid_field_error(_request: Request, exc: Exception) -> Response:
    error = cast(InvalidFieldError, exc)
    entry = {"type": error.code, "loc": error.loc, "msg": error.detail}
    return JSONResponse({"detail": [entry]}, status_code=error.status_code)


async def _handle_http_exception(_request: Request, exc: Exception) -> Response:
    """Routing 404/405 and any `HTTPException` (kept for compatibility, not for new code)."""
    error = cast(StarletteHTTPException, exc)
    headers = dict(error.headers) if error.headers else None
    if error.status_code < 200 or error.status_code in (204, 304):
        return Response(status_code=error.status_code, headers=headers)  # no body allowed
    return _error_response(
        error.status_code, str(error.detail), _code_for_http_status(error.status_code), headers
    )


def register_exception_handlers(app: FastAPI) -> None:
    # Starlette picks the handler of the most specific class, so InvalidFieldError wins over
    # AppError. RequestValidationError keeps FastAPI's default handler (the 422 list format).
    app.add_exception_handler(AppError, _handle_app_error)
    app.add_exception_handler(InvalidFieldError, _handle_invalid_field_error)
    app.add_exception_handler(StarletteHTTPException, _handle_http_exception)

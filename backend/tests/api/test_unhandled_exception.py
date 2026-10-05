import io
import json
from typing import Any

from fastapi import FastAPI
from httpx import AsyncClient
from starlette.types import Message, Receive, Scope, Send

from app.core.logging import RequestIdMiddleware


def _add_boom_routes(app: FastAPI) -> None:
    @app.get("/_test/boom")
    async def boom() -> dict[str, str]:
        raise RuntimeError("kaboom")


def _log_lines(log_stream: io.StringIO) -> list[dict[str, Any]]:
    parsed = [json.loads(line) for line in log_stream.getvalue().splitlines()]
    # The httpx test client logs its own call from outside the app's request scope.
    return [line for line in parsed if line["logger"] != "httpx"]


async def test_unhandled_exception_returns_500_in_the_single_error_format(
    app: FastAPI, client: AsyncClient
) -> None:
    _add_boom_routes(app)

    # No exception escapes the app: if one did, uvicorn would log a second traceback.
    response = await client.get("/_test/boom")

    assert response.status_code == 500
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {"detail": "Internal server error", "code": "internal_error"}


async def test_unhandled_exception_never_leaks_traces_or_messages_to_the_client(
    app: FastAPI, client: AsyncClient
) -> None:
    _add_boom_routes(app)

    response = await client.get("/_test/boom")

    assert "kaboom" not in response.text
    assert "Traceback" not in response.text
    assert "RuntimeError" not in response.text


async def test_500_response_carries_the_incoming_request_id(
    app: FastAPI, client: AsyncClient
) -> None:
    _add_boom_routes(app)

    response = await client.get("/_test/boom", headers={"X-Request-ID": "rid-500"})

    assert response.headers["x-request-id"] == "rid-500"


async def test_500_responses_get_distinct_generated_request_ids(
    app: FastAPI, client: AsyncClient
) -> None:
    _add_boom_routes(app)

    first = await client.get("/_test/boom")
    second = await client.get("/_test/boom")

    assert first.headers["x-request-id"]
    assert first.headers["x-request-id"] != second.headers["x-request-id"]


async def test_unhandled_exception_is_logged_once_with_traceback_and_request_id(
    app: FastAPI, client: AsyncClient, log_stream: io.StringIO
) -> None:
    _add_boom_routes(app)

    response = await client.get("/_test/boom?token=s3cret", headers={"X-Request-ID": "rid-500"})

    assert response.status_code == 500
    lines = _log_lines(log_stream)
    traces = [line for line in lines if "exception" in line]
    assert len(traces) == 1
    assert traces[0]["request_id"] == "rid-500"
    assert traces[0]["severity"] == "ERROR"
    assert "RuntimeError: kaboom" in traces[0]["exception"]
    assert "s3cret" not in json.dumps(traces[0])

    completed = next(line for line in lines if line["message"] == "request_completed")
    assert completed["status"] == 500
    assert completed["request_id"] == "rid-500"
    assert "s3cret" not in json.dumps(completed)


async def test_response_header_matches_the_request_id_in_the_logged_trace(
    app: FastAPI, client: AsyncClient, log_stream: io.StringIO
) -> None:
    _add_boom_routes(app)

    response = await client.get("/_test/boom")

    trace = next(line for line in _log_lines(log_stream) if "exception" in line)
    assert trace["request_id"] == response.headers["x-request-id"]


async def test_exception_after_the_response_started_is_logged_once_and_not_raised(
    log_stream: io.StringIO,
) -> None:
    # Driven at the ASGI level: httpx's transport insists that a response completes.
    sent: list[Message] = []

    async def failing_app(scope: Scope, receive: Receive, send: Send) -> None:
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"partial", "more_body": True})
        raise RuntimeError("kaboom after start")

    async def receive() -> Message:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: Message) -> None:
        sent.append(message)

    scope: Scope = {
        "type": "http",
        "method": "GET",
        "path": "/stream",
        "headers": [(b"x-request-id", b"rid-late")],
    }

    await RequestIdMiddleware(failing_app)(scope, receive, send)

    # The status line was already sent, so no second response (a 500) can follow it.
    assert [m["type"] for m in sent] == ["http.response.start", "http.response.body"]
    traces = [line for line in _log_lines(log_stream) if "exception" in line]
    assert len(traces) == 1
    assert traces[0]["request_id"] == "rid-late"
    assert "kaboom after start" in traces[0]["exception"]

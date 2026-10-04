import io
import json
import logging

import pytest
from fastapi import FastAPI
from httpx import AsyncClient


async def test_healthz_returns_200_with_status_ok(client: AsyncClient) -> None:
    response = await client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_healthz_does_not_require_auth(client: AsyncClient) -> None:
    response = await client.get("/healthz")  # no Authorization header
    assert response.status_code == 200


async def test_healthz_response_carries_request_id_header(client: AsyncClient) -> None:
    response = await client.get("/healthz")
    assert len(response.headers["x-request-id"]) > 0


async def test_request_id_from_header_is_echoed_back(client: AsyncClient) -> None:
    response = await client.get("/healthz", headers={"X-Request-ID": "abc-123.X_y"})
    assert response.headers["x-request-id"] == "abc-123.X_y"


async def test_invalid_request_id_header_is_replaced_by_generated_one(
    client: AsyncClient,
) -> None:
    for bad in ["has space", "a" * 65, "semi;colon", "tab\there"]:
        response = await client.get("/healthz", headers={"X-Request-ID": bad})
        assert response.headers["x-request-id"] != bad
        assert len(response.headers["x-request-id"]) > 0


async def test_each_request_without_header_gets_distinct_request_id(
    client: AsyncClient,
) -> None:
    first = await client.get("/healthz")
    second = await client.get("/healthz")
    assert first.headers["x-request-id"] != second.headers["x-request-id"]


async def test_every_log_line_during_request_has_request_id(
    app: FastAPI, client: AsyncClient, log_stream: io.StringIO
) -> None:
    @app.get("/_test/log")
    async def _log() -> dict[str, str]:
        logging.getLogger("tests.route").info("inside handler")
        return {}

    response = await client.get("/_test/log?secret=1", headers={"X-Request-ID": "rid-42"})
    assert response.status_code == 200

    parsed = [json.loads(line) for line in log_stream.getvalue().splitlines()]
    # The httpx test client logs its own call from outside the app's request scope.
    excluded = [line for line in parsed if line["logger"] == "httpx"]
    assert len(excluded) == 1
    assert excluded[0]["message"].startswith("HTTP Request:")
    lines = [line for line in parsed if line["logger"] != "httpx"]
    messages = {line["message"] for line in lines}
    assert {"inside handler", "request_completed"} <= messages
    assert all(line["request_id"] == "rid-42" for line in lines)

    completed = next(line for line in lines if line["message"] == "request_completed")
    assert completed["method"] == "GET"
    assert completed["path"] == "/_test/log"
    assert completed["status"] == 200
    assert "duration_ms" in completed
    assert "secret" not in json.dumps(completed)


async def test_unhandled_exception_is_logged_with_traceback_and_request_id(
    app: FastAPI, client: AsyncClient, log_stream: io.StringIO
) -> None:
    @app.get("/_test/boom")
    async def _boom() -> dict[str, str]:
        raise RuntimeError("kaboom")

    with pytest.raises(RuntimeError):
        await client.get("/_test/boom?token=s3cret", headers={"X-Request-ID": "rid-500"})

    lines = [json.loads(line) for line in log_stream.getvalue().splitlines()]
    lines = [line for line in lines if line["logger"] != "httpx"]
    errors = [line for line in lines if "exception" in line]
    assert len(errors) == 1
    assert errors[0]["request_id"] == "rid-500"
    assert errors[0]["level"] == "ERROR"
    assert "RuntimeError: kaboom" in errors[0]["exception"]
    assert "s3cret" not in json.dumps(errors[0])

    completed = next(line for line in lines if line["message"] == "request_completed")
    assert completed["status"] == 500
    assert completed["request_id"] == "rid-500"
    assert "s3cret" not in json.dumps(completed)

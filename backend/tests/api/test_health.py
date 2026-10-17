import io
import json
import logging

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from httpx import AsyncClient

from app.health import router as health_router

# Cloud Run reserves some paths ending in `z` (its frontend answers /healthz before the app
# sees the request), so the probe is /health and /healthz does not exist (see test_routing.py).
HEALTH_PATHS = ["/health"]


@pytest.mark.parametrize("path", HEALTH_PATHS)
async def test_health_returns_200_with_status_ok(client: AsyncClient, path: str) -> None:
    response = await client.get(path)
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize("path", HEALTH_PATHS)
async def test_health_does_not_require_auth_or_a_session_cookie(
    client: AsyncClient, path: str
) -> None:
    response = await client.get(path)  # no cookie, no Authorization header
    assert response.status_code == 200


@pytest.mark.parametrize("path", HEALTH_PATHS)
async def test_health_carries_and_echoes_the_request_id(client: AsyncClient, path: str) -> None:
    generated = await client.get(path)
    assert generated.status_code == 200
    assert len(generated.headers["x-request-id"]) > 0

    echoed = await client.get(path, headers={"X-Request-ID": "probe-1.A_b"})
    assert echoed.headers["x-request-id"] == "probe-1.A_b"


def test_health_routes_have_no_dependencies() -> None:
    # No DbSession, no CurrentUser, no Firebase: a health probe must answer even if they are down.
    # (FastAPI 0.142 nests included routers lazily, so the router itself is inspected.)
    routes = {route.path: route for route in health_router.routes if isinstance(route, APIRoute)}

    assert sorted(routes) == sorted(HEALTH_PATHS)
    for path, route in routes.items():
        assert route.dependant.dependencies == [], path
        assert route.methods == {"GET"}, path


async def test_healthz_is_not_served(client: AsyncClient) -> None:
    # Cloud Run reserves paths ending in `z`: the app must not expose one.
    response = await client.get("/healthz")

    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found", "code": "not_found"}


async def test_health_endpoint_returns_200_with_status_ok(client: AsyncClient) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_health_endpoint_does_not_require_auth(client: AsyncClient) -> None:
    response = await client.get("/health")  # no Authorization header
    assert response.status_code == 200


async def test_health_endpoint_response_carries_request_id_header(client: AsyncClient) -> None:
    response = await client.get("/health")
    assert len(response.headers["x-request-id"]) > 0


async def test_request_id_from_header_is_echoed_back(client: AsyncClient) -> None:
    response = await client.get("/health", headers={"X-Request-ID": "abc-123.X_y"})
    assert response.headers["x-request-id"] == "abc-123.X_y"


async def test_invalid_request_id_header_is_replaced_by_generated_one(
    client: AsyncClient,
) -> None:
    for bad in ["has space", "a" * 65, "semi;colon", "tab\there"]:
        response = await client.get("/health", headers={"X-Request-ID": bad})
        assert response.headers["x-request-id"] != bad
        assert len(response.headers["x-request-id"]) > 0


async def test_each_request_without_header_gets_distinct_request_id(
    client: AsyncClient,
) -> None:
    first = await client.get("/health")
    second = await client.get("/health")
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

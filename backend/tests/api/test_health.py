import io
import json
import logging

from fastapi import FastAPI
from fastapi.routing import APIRoute
from httpx import AsyncClient

from app.health import router as health_router

# Cloud Run reserves some paths ending in `z` (its frontend answers /healthz before the app
# sees the request), so the probe is /health and /healthz does not exist (see test_routing.py).


async def test_health_returns_200_with_status_ok_without_auth(client: AsyncClient) -> None:
    response = await client.get("/health")  # no cookie, no Authorization header
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_route_has_no_dependencies() -> None:
    # No DbSession, no CurrentUser, no Firebase: a health probe must answer even if they are down.
    # (FastAPI 0.142 nests included routers lazily, so the router itself is inspected.)
    routes = {route.path: route for route in health_router.routes if isinstance(route, APIRoute)}

    assert list(routes) == ["/health"]
    route = routes["/health"]
    assert route.dependant.dependencies == []
    assert route.methods == {"GET"}


async def test_healthz_is_not_served(client: AsyncClient) -> None:
    # Cloud Run reserves paths ending in `z`: the app must not expose one.
    response = await client.get("/healthz")

    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found", "code": "not_found"}


async def test_health_response_carries_a_generated_request_id(client: AsyncClient) -> None:
    response = await client.get("/health")
    assert len(response.headers["x-request-id"]) > 0


async def test_request_id_from_header_is_echoed_back(client: AsyncClient) -> None:
    for valid in ["abc-123.X_y", "probe-1.A_b"]:
        response = await client.get("/health", headers={"X-Request-ID": valid})
        assert response.headers["x-request-id"] == valid


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

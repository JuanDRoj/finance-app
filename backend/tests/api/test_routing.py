import re
import uuid

from fastapi import APIRouter, Depends, FastAPI
from httpx import AsyncClient

from app.main import create_app
from app.modules.spaces.dependencies import require_space_member
from tests.fakes import FakeFirebaseAuth


def _add_things_router(app: FastAPI) -> None:
    router = APIRouter(prefix="/things", tags=["things"])

    @router.get("")
    async def list_things() -> list[int]:
        return []

    @router.get("/{thing_id}")
    async def get_thing(thing_id: int) -> int:
        return thing_id

    app.include_router(router)


def test_no_route_of_the_api_ends_with_a_trailing_slash() -> None:
    app = create_app()
    _add_things_router(app)

    paths = app.openapi()["paths"]

    assert paths  # the check below must not pass vacuously
    assert [path for path in paths if path != "/" and path.endswith("/")] == []


async def test_collection_route_is_served_without_trailing_slash(
    app: FastAPI, client: AsyncClient
) -> None:
    _add_things_router(app)

    response = await client.get("/things")

    assert response.status_code == 200
    assert (await client.get("/things/3")).json() == 3


async def test_trailing_slash_gives_404_and_not_a_307_redirect(
    app: FastAPI, client: AsyncClient
) -> None:
    _add_things_router(app)

    for path in ("/things/", "/things/3/", "/healthz/"):
        response = await client.get(path)
        assert response.status_code == 404, path
        assert "location" not in response.headers
        assert response.json() == {"detail": "Not Found", "code": "not_found"}


async def test_a_route_declared_with_a_trailing_slash_is_not_redirected(
    app: FastAPI, client: AsyncClient
) -> None:
    # The convention is `""` under a prefix; declaring "/" must not silently redirect.
    router = APIRouter(prefix="/legacy")

    @router.get("/")
    async def legacy() -> list[int]:
        return []

    app.include_router(router)

    response = await client.get("/legacy")

    assert response.status_code == 404
    assert "location" not in response.headers


async def _space_routes_open_to_anonymous(app: FastAPI, client: AsyncClient) -> list[str]:
    """`METHOD path` of every `/spaces/{space_id}/...` operation that answers without a session.

    Behavioural on purpose (FastAPI keeps its routing internals private): a route that declares
    `require_space_member` answers 401 `not_authenticated` to a request with no cookie, before
    validating the body or looking for the space.
    """
    open_routes: list[str] = []
    for path, operations in app.openapi()["paths"].items():
        if not path.startswith("/spaces/{space_id}"):
            continue
        url = re.sub(r"\{[^}]+\}", str(uuid.uuid4()), path)
        for method in operations:
            response = await client.request(method.upper(), url)
            body = response.json() if response.content else {}
            if response.status_code != 401 or body.get("code") != "not_authenticated":
                open_routes.append(f"{method.upper()} {path}")
    return open_routes


async def test_every_space_route_of_the_api_requires_space_membership(
    app: FastAPI, api_client: AsyncClient, fake_firebase: FakeFirebaseAuth
) -> None:
    assert await _space_routes_open_to_anonymous(app, api_client) == []


async def test_the_space_route_guard_detects_a_route_without_the_dependency(
    app: FastAPI, api_client: AsyncClient, fake_firebase: FakeFirebaseAuth
) -> None:
    protected = APIRouter(
        prefix="/spaces/{space_id}/a", dependencies=[Depends(require_space_member)]
    )
    unprotected = APIRouter(prefix="/spaces/{space_id}/b")

    @protected.get("")
    async def protected_route() -> int:
        return 1

    @unprotected.post("")
    async def unprotected_route() -> int:
        return 1

    app.include_router(protected)
    app.include_router(unprotected)

    assert await _space_routes_open_to_anonymous(app, api_client) == ["POST /spaces/{space_id}/b"]

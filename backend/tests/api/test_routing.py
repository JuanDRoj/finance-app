from fastapi import APIRouter, FastAPI
from httpx import AsyncClient

from app.main import create_app


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

import re
import uuid

from fastapi import APIRouter, Depends, FastAPI
from fastapi.routing import iter_route_contexts
from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import create_app
from app.modules.auth.dependencies import get_current_user
from app.modules.spaces.dependencies import require_space_member
from app.modules.users import service as users_service
from tests.fakes import FakeFirebaseAuth, make_identity


def _add_things_router(app: FastAPI) -> None:
    router = APIRouter(prefix="/things", tags=["things"])

    @router.get("")
    async def list_things() -> list[int]:
        return []

    @router.get("/{thing_id}")
    async def get_thing(thing_id: int) -> int:
        return thing_id

    app.include_router(router)


def _route_paths(app: FastAPI) -> list[str]:
    """Every path the app serves, also the ones hidden from the schema (`include_in_schema=False`).

    `app.openapi()["paths"]` skips hidden routes, and `app.routes` holds included routers lazily
    (FastAPI 0.142), so `iter_route_contexts` flattens them with their effective, prefixed path.
    """
    return [route.path for route in iter_route_contexts(app.routes) if route.path is not None]


def _paths_with_trailing_slash(app: FastAPI) -> list[str]:
    return [path for path in _route_paths(app) if path != "/" and path.endswith("/")]


# Cloud Run reserves some paths ending in `z` (its frontend answers them before the app sees the
# request) and recommends avoiding all of them. No exceptions: the health route is `/health`.
def _paths_ending_in_z(app: FastAPI) -> list[str]:
    return [path for path in _route_paths(app) if path.endswith("z")]


def test_no_route_of_the_api_ends_with_a_trailing_slash() -> None:
    app = create_app()
    _add_things_router(app)

    assert _route_paths(app)  # the check below must not pass vacuously
    assert _paths_with_trailing_slash(app) == []


def test_no_route_of_the_api_ends_in_z() -> None:
    app = create_app()
    _add_things_router(app)

    assert "/health" in _route_paths(app)  # the Cloud Run safe health route must exist
    assert _paths_ending_in_z(app) == []


def test_the_path_rules_also_see_routes_hidden_from_the_schema() -> None:
    app = create_app()  # a fresh app: nothing is left registered in the shared one
    hidden = APIRouter(prefix="/hidden")

    @hidden.get("/probez", include_in_schema=False)
    async def ends_in_z() -> int:
        return 1

    @hidden.get("/slash/", include_in_schema=False)
    async def ends_in_slash() -> int:
        return 1

    app.include_router(hidden)

    assert "/hidden/probez" not in app.openapi()["paths"]
    assert _paths_ending_in_z(app) == ["/hidden/probez"]
    assert _paths_with_trailing_slash(app) == ["/hidden/slash/"]


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

    for path in ("/things/", "/things/3/", "/health/"):
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


async def _unguarded_space_routes(
    app: FastAPI, client: AsyncClient, session: AsyncSession, firebase: FakeFirebaseAuth
) -> list[str]:
    """`METHOD path` of every `/spaces/{space_id}/...` operation that lacks a membership check.

    Behavioural on purpose (FastAPI keeps its routing internals private). It walks
    `app.openapi()`, so a route with `include_in_schema=False` is outside the check.
    Two requests per operation, both with random ids, answered before the body is validated:
    - no cookie: 401 `not_authenticated` (the route is behind `current_user`);
    - a valid session of a user with no spaces: 404 `space_not_found`. A route that only uses
      `CurrentUser` passes the first check and fails this one, which is the IDOR to catch.
    """
    await users_service.upsert_user(
        session, firebase_uid="uid-guard", email="guard@example.com", display_name=None
    )
    firebase.session_identity = make_identity(uid="uid-guard")
    unguarded: list[str] = []
    for path, operations in app.openapi()["paths"].items():
        if not path.startswith("/spaces/{space_id}"):
            continue
        url = re.sub(r"\{[^}]+\}", str(uuid.uuid4()), path)
        for method in operations:
            anonymous = await client.request(method.upper(), url)
            outsider = await client.request(
                method.upper(), url, headers={"Cookie": "session=valid-cookie"}
            )
            if _code(anonymous) != (401, "not_authenticated") or _code(outsider) != (
                404,
                "space_not_found",
            ):
                unguarded.append(f"{method.upper()} {path}")
    return unguarded


def _code(response: Response) -> tuple[int, str | None]:
    body = response.json() if response.content else {}
    return response.status_code, body.get("code") if isinstance(body, dict) else None


async def test_every_space_route_of_the_api_requires_space_membership(
    app: FastAPI,
    api_client: AsyncClient,
    session: AsyncSession,
    fake_firebase: FakeFirebaseAuth,
) -> None:
    assert await _unguarded_space_routes(app, api_client, session, fake_firebase) == []


async def test_the_space_route_guard_detects_routes_without_the_membership_check(
    app: FastAPI,
    api_client: AsyncClient,
    session: AsyncSession,
    fake_firebase: FakeFirebaseAuth,
) -> None:
    protected = APIRouter(
        prefix="/spaces/{space_id}/a", dependencies=[Depends(require_space_member)]
    )
    open_router = APIRouter(prefix="/spaces/{space_id}/b")
    login_only = APIRouter(prefix="/spaces/{space_id}/c", dependencies=[Depends(get_current_user)])

    @protected.get("")
    async def protected_route() -> int:
        return 1

    @open_router.post("")
    async def open_route() -> int:
        return 1

    @login_only.get("")
    async def login_only_route() -> int:
        return 1

    for router in (protected, open_router, login_only):
        app.include_router(router)

    assert await _unguarded_space_routes(app, api_client, session, fake_firebase) == [
        "POST /spaces/{space_id}/b",
        "GET /spaces/{space_id}/c",
    ]

import re
import uuid
from collections.abc import Callable

import pytest
from fastapi import APIRouter, Depends, FastAPI, WebSocket
from fastapi.routing import iter_route_contexts
from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request
from starlette.responses import PlainTextResponse

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


SPACE_PREFIX = "/spaces/{space_id}"


def _operations(app: FastAPI) -> list[tuple[str, str]]:
    """`(METHOD, path)` of every operation in the OpenAPI schema (hidden routes are not there)."""
    return [
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        for method in operations
    ]


def _space_operations(app: FastAPI) -> list[tuple[str, str]]:
    """The operations under `/spaces/{space_id}`: the ones the membership guard has to protect."""
    return [(method, path) for method, path in _operations(app) if path.startswith(SPACE_PREFIX)]


def _with_random_ids(path: str) -> str:
    return re.sub(r"\{[^}]+\}", str(uuid.uuid4()), path)


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
    for method, path in _space_operations(app):
        url = _with_random_ids(path)
        anonymous = await client.request(method, url)
        outsider = await client.request(method, url, headers={"Cookie": "session=valid-cookie"})
        if _code(anonymous) != (401, "not_authenticated") or _code(outsider) != (
            404,
            "space_not_found",
        ):
            unguarded.append(f"{method} {path}")
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


# What the guard has to walk -----------------------------------------------------------------

# The operations that must be under the membership guard (accounts, balances, currency, categories
# and movements). A subset, not the whole inventory: adding a route must not break this test, but
# losing one of these from the walk (a renamed prefix, a router that stops being included) must.
EXPECTED_SPACE_OPERATIONS = {
    ("GET", "/spaces/{space_id}"),
    ("PATCH", "/spaces/{space_id}"),
    ("GET", "/spaces/{space_id}/accounts"),
    ("POST", "/spaces/{space_id}/accounts"),
    ("GET", "/spaces/{space_id}/accounts/{account_id}"),
    ("PATCH", "/spaces/{space_id}/accounts/{account_id}"),
    ("POST", "/spaces/{space_id}/accounts/{account_id}/archive"),
    ("POST", "/spaces/{space_id}/accounts/{account_id}/unarchive"),
    ("POST", "/spaces/{space_id}/accounts/{account_id}/reconcile"),
    ("GET", "/spaces/{space_id}/balance-summary"),
    ("GET", "/spaces/{space_id}/categories"),
    ("POST", "/spaces/{space_id}/categories"),
    ("PATCH", "/spaces/{space_id}/categories/{category_id}"),
    ("POST", "/spaces/{space_id}/categories/{category_id}/archive"),
    ("POST", "/spaces/{space_id}/categories/{category_id}/unarchive"),
    ("POST", "/spaces/{space_id}/transactions"),
}


def test_the_membership_guard_walks_the_account_balance_currency_and_category_routes() -> None:
    walked = set(_space_operations(create_app()))

    assert EXPECTED_SPACE_OPERATIONS - walked == set()


# Routes outside the spaces: the session is the only guard -------------------------------------

# The only operations that answer without a session. Anything new must either require one or be
# added here on purpose, so a route cannot become public by forgetting a dependency.
PUBLIC_OPERATIONS = {
    ("GET", "/health"),
    ("POST", "/auth/session"),
    ("DELETE", "/auth/session"),
}


async def _operations_without_session(app: FastAPI, client: AsyncClient) -> list[str]:
    """`METHOD path` of every non-public operation that does not answer 401 `not_authenticated`.

    One request without cookie and with random ids, answered before the body is validated.
    """
    open_operations: list[str] = []
    for method, path in _operations(app):
        if (method, path) in PUBLIC_OPERATIONS:
            continue
        response = await client.request(method, _with_random_ids(path))
        if _code(response) != (401, "not_authenticated"):
            open_operations.append(f"{method} {path}")
    return open_operations


async def test_every_route_outside_the_public_list_requires_a_session(
    app: FastAPI, api_client: AsyncClient, fake_firebase: FakeFirebaseAuth
) -> None:
    operations = set(_operations(app))

    assert operations >= PUBLIC_OPERATIONS  # the allow-list must not rot
    # The walk must not pass vacuously: the routes that live outside `/spaces/{space_id}`.
    assert operations >= {("GET", "/currencies"), ("GET", "/me"), ("GET", "/spaces")}
    assert await _operations_without_session(app, api_client) == []
    assert not fake_firebase.called  # no cookie, so Firebase was never asked


async def test_the_session_guard_detects_a_route_that_does_not_require_a_session(
    app: FastAPI, api_client: AsyncClient, fake_firebase: FakeFirebaseAuth
) -> None:
    router = APIRouter(prefix="/leaky")

    @router.get("")
    async def leaky_route() -> int:
        return 1

    app.include_router(router)

    assert await _operations_without_session(app, api_client) == ["GET /leaky"]


# Routes served but absent from the schema ---------------------------------------------------------

# R2 walks `app.openapi()`, so a route left out of the schema would skip the session check. The
# only routes allowed to be served without being in the schema are the documentation ones that
# FastAPI itself creates: Swagger UI (`/docs`) and its OAuth2 redirect, ReDoc (`/redoc`) and the
# schema (`/openapi.json`, which does not describe itself). They exist only with ENV=local
# (`docs_enabled()`; staging and production serve none, see `test_docs_exposure.py`), hold no user
# data and need no session on purpose: a developer reads the contract through them. Starlette adds
# HEAD to each GET. Listed one by one, not by a prefix like `/docs*`, so a new route next to them
# still has to be looked at.
HIDDEN_FROM_THE_SCHEMA = {
    (method, path)
    for path in ("/docs", "/docs/oauth2-redirect", "/openapi.json", "/redoc")
    for method in ("GET", "HEAD")
}


def _served_operations(app: FastAPI) -> set[tuple[str, str]]:
    """`(METHOD, path)` of everything the app serves, hidden from the schema or not.

    `app.routes` holds included routers lazily (FastAPI 0.142), so `iter_route_contexts` flattens
    them with their effective, prefixed path. A route without methods (a mounted app, a WebSocket)
    counts as `ANY`. Nothing here reads `include_in_schema`: a mount does not even have it, and a
    plain Starlette route says `True` but is never drawn by FastAPI's schema.
    """
    return {
        (method, context.path)
        for context in iter_route_contexts(app.routes)
        if context.path is not None
        for method in context.methods or {"ANY"}
    }


def _served_outside_the_schema(app: FastAPI) -> list[tuple[str, str]]:
    return sorted(_served_operations(app) - set(_operations(app)))


def test_every_served_route_is_in_the_schema_except_the_listed_documentation_routes() -> None:
    app = create_app()

    # The check must not pass vacuously: it sees the routes the guards protect.
    served_paths = {path for _, path in _served_operations(app)}
    assert {path for _, path in EXPECTED_SPACE_OPERATIONS} <= served_paths
    outside = set(_served_outside_the_schema(app))
    assert sorted(outside - HIDDEN_FROM_THE_SCHEMA) == []  # a route nobody decided to hide
    assert sorted(HIDDEN_FROM_THE_SCHEMA - outside) == []  # an entry of the list that is gone


def _hide_on_the_decorator(app: FastAPI) -> None:
    router = APIRouter(prefix="/spaces/{space_id}/a")

    @router.get("", include_in_schema=False)
    async def hidden() -> int:
        return 1

    app.include_router(router)


def _hide_on_the_router(app: FastAPI) -> None:
    router = APIRouter(prefix="/spaces/{space_id}/b", include_in_schema=False)

    @router.get("")
    async def hidden() -> int:
        return 1

    app.include_router(router)


def _hide_on_the_include(app: FastAPI) -> None:
    router = APIRouter(prefix="/spaces/{space_id}/c")

    @router.get("")
    async def hidden() -> int:
        return 1

    app.include_router(router, include_in_schema=False)


def _hide_outside_the_spaces(app: FastAPI) -> None:
    router = APIRouter(prefix="/elsewhere")

    @router.post("", include_in_schema=False)
    async def hidden() -> int:
        return 1

    app.include_router(router)


def _serve_a_plain_starlette_route(app: FastAPI) -> None:
    async def plain(request: Request) -> PlainTextResponse:
        return PlainTextResponse("plain")

    # Says include_in_schema=True, but FastAPI only draws its own APIRoute in the schema.
    app.add_route("/plain", plain, methods=["GET"])


def _mount_another_app(app: FastAPI) -> None:
    app.mount("/sub", FastAPI())


def _serve_a_websocket(app: FastAPI) -> None:
    async def socket(websocket: WebSocket) -> None:
        await websocket.close()

    app.add_api_websocket_route("/socket", socket)


@pytest.mark.parametrize(
    ("serve", "expected"),
    [
        (_hide_on_the_decorator, [("GET", "/spaces/{space_id}/a")]),
        (_hide_on_the_router, [("GET", "/spaces/{space_id}/b")]),
        (_hide_on_the_include, [("GET", "/spaces/{space_id}/c")]),
        (_hide_outside_the_spaces, [("POST", "/elsewhere")]),
        (_serve_a_plain_starlette_route, [("GET", "/plain"), ("HEAD", "/plain")]),
        (_mount_another_app, [("ANY", "/sub")]),
        (_serve_a_websocket, [("ANY", "/socket")]),
    ],
    ids=[
        "hidden_on_the_decorator",
        "hidden_on_the_router",
        "hidden_on_the_include",
        "hidden_outside_the_spaces",
        "plain_starlette_route",
        "mounted_app",
        "websocket",
    ],
)
def test_the_schema_check_sees_every_way_of_serving_a_route_outside_the_schema(
    serve: Callable[[FastAPI], None], expected: list[tuple[str, str]]
) -> None:
    app = create_app()  # a fresh app: nothing is left registered in the shared one
    serve(app)

    unlisted = [op for op in _served_outside_the_schema(app) if op not in HIDDEN_FROM_THE_SCHEMA]

    assert unlisted == expected

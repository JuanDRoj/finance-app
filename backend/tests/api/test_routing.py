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


def _hidden_space_paths(app: FastAPI) -> list[str]:
    """Paths under `/spaces/{space_id}` served but left out of the schema.

    `include_in_schema` is read from the effective route, which also counts the flag set on
    `include_router(...)` or on the `APIRouter`, not only on the decorator.
    """
    return [
        context.path
        for context in iter_route_contexts(app.routes)
        if context.path is not None
        and context.path.startswith(SPACE_PREFIX)
        and not context.include_in_schema
    ]


def test_no_space_route_is_hidden_from_the_schema() -> None:
    app = create_app()

    served = [
        context.path
        for context in iter_route_contexts(app.routes)
        if context.path is not None and context.path.startswith(SPACE_PREFIX)
    ]
    assert len(served) >= len(EXPECTED_SPACE_OPERATIONS)  # the check below is not vacuous
    assert _hidden_space_paths(app) == []


def test_the_hidden_route_check_sees_every_way_of_leaving_a_route_out_of_the_schema() -> None:
    app = create_app()
    on_the_decorator = APIRouter(prefix="/spaces/{space_id}/a")
    on_the_router = APIRouter(prefix="/spaces/{space_id}/b", include_in_schema=False)
    on_the_include = APIRouter(prefix="/spaces/{space_id}/c")

    @on_the_decorator.get("", include_in_schema=False)
    async def hidden_by_the_decorator() -> int:
        return 1

    @on_the_router.get("")
    async def hidden_by_the_router() -> int:
        return 1

    @on_the_include.get("")
    async def hidden_by_the_include() -> int:
        return 1

    app.include_router(on_the_decorator)
    app.include_router(on_the_router)
    app.include_router(on_the_include, include_in_schema=False)

    assert _hidden_space_paths(app) == [
        "/spaces/{space_id}/a",
        "/spaces/{space_id}/b",
        "/spaces/{space_id}/c",
    ]

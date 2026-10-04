import io
import logging
import os
import shutil
import uuid
from collections.abc import AsyncIterator, Callable, Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import Settings, get_settings
from app.core.db import Database
from app.core.logging import JsonFormatter, RequestIdFilter
from app.main import create_app

BACKEND_DIR = Path(__file__).resolve().parents[1]

DEFAULT_TEST_DATABASE_URL = "postgresql+asyncpg://finance:finance_dev@localhost:5432/finance_test"

# Every variable that changes how the database is reached or how the pool is sized.
_DB_ENV_VARS = (
    "DATABASE_URL",
    "INSTANCE_CONNECTION_NAME",
    "DB_USER",
    "DB_PASSWORD",
    "DB_NAME",
    "DB_IP_TYPE",
    "DB_POOL_SIZE",
    "DB_MAX_OVERFLOW",
    "DB_POOL_TIMEOUT",
)


@pytest.fixture(autouse=True)
def _isolated_settings(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Keep tests independent of the developer's shell and backend/.env."""
    # A developer's backend/.env must never leak into a test (it could point at the dev DB).
    monkeypatch.setitem(Settings.model_config, "env_file", None)
    monkeypatch.setenv("ENV", "local")
    monkeypatch.setenv("LOG_LEVEL", "INFO")
    monkeypatch.delenv("FIREBASE_AUTH_EMULATOR_HOST", raising=False)
    for var in _DB_ENV_VARS:
        monkeypatch.delenv(var, raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def app() -> FastAPI:
    return create_app()


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
def log_stream() -> Iterator[io.StringIO]:
    """Capture every log line emitted through the root logger as JSON."""
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(RequestIdFilter())
    root = logging.getLogger()
    previous_level = root.level
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    try:
        yield stream
    finally:
        root.removeHandler(handler)
        root.setLevel(previous_level)


@pytest.fixture
def restore_root_logger() -> Iterator[None]:
    """Undo `configure_logging`, which replaces the root handlers (lifespan, alembic CLI)."""
    root = logging.getLogger()
    handlers, level = list(root.handlers), root.level
    try:
        yield
    finally:
        root.handlers = handlers
        root.setLevel(level)


@pytest.fixture
def isolated_backend(tmp_path: Path) -> Path:
    """Working directory for subprocess tests: a copy of the code, without `.env`.

    Settings reads `.env` relative to the cwd, so a subprocess started in `backend/` would pick
    up the developer's file and the result would depend on the machine. The environment is
    already clean: `_isolated_settings` removes the database variables from `os.environ`.
    """
    root = tmp_path / "backend"
    root.mkdir()
    ignore = shutil.ignore_patterns("__pycache__", "*.pyc")
    shutil.copytree(BACKEND_DIR / "app", root / "app", ignore=ignore)
    shutil.copytree(BACKEND_DIR / "migrations", root / "migrations", ignore=ignore)
    shutil.copy(BACKEND_DIR / "alembic.ini", root / "alembic.ini")
    return root


# --- PostgreSQL (real, from Docker Compose; never SQLite) ---------------------------------


@pytest.fixture(scope="session")
def test_database_url() -> URL:
    """URL of the test database. Refuses anything that is not named `*_test`.

    Migration tests run `downgrade base`, so pointing them at a development database would
    wipe it. The guard lives here so no test can skip it.
    """
    url = make_url(os.environ.get("TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL))
    if not (url.database or "").endswith("_test"):
        pytest.exit(
            f"Refusing to run: test database name must end with '_test' (got {url.database!r}).",
            returncode=2,
        )
    return url


def _as_string(url: URL) -> str:
    return url.render_as_string(hide_password=False)


@pytest.fixture
def settings_factory(
    monkeypatch: pytest.MonkeyPatch, test_database_url: URL
) -> Callable[..., Settings]:
    """Build Settings that point at the test database; extra env vars override the defaults.

    `database_url=None` leaves DATABASE_URL unset (Connector scenarios).
    """

    def make(*, database_url: str | None = None, **env: str) -> Settings:
        monkeypatch.setenv("DATABASE_URL", database_url or _as_string(test_database_url))
        for key, value in env.items():
            monkeypatch.setenv(key, value)
        return Settings()

    return make


@pytest.fixture
async def database(settings_factory: Callable[..., Settings]) -> AsyncIterator[Database]:
    """A `Database` on the shared test database, with the default pool."""
    db = await Database.create(settings_factory())
    try:
        yield db
    finally:
        await db.dispose()


@pytest.fixture
async def scratch_database_url(
    monkeypatch: pytest.MonkeyPatch, test_database_url: URL
) -> AsyncIterator[str]:
    """A brand-new, empty database (own name, ends with `_test`), dropped afterwards.

    DATABASE_URL is pointed at it, so `get_settings()` (alembic env.py) uses it too.
    """
    name = f"finance_scratch_{uuid.uuid4().hex[:12]}_test"  # generated here, never user input
    admin = create_async_engine(test_database_url, isolation_level="AUTOCOMMIT")
    try:
        async with admin.connect() as conn:
            await conn.execute(text(f'CREATE DATABASE "{name}"'))
        url = _as_string(test_database_url.set(database=name))
        monkeypatch.setenv("DATABASE_URL", url)
        get_settings.cache_clear()
        yield url
    finally:
        async with admin.connect() as conn:
            await conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        await admin.dispose()

import io
import logging
from collections.abc import AsyncIterator, Iterator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.core.logging import JsonFormatter, RequestIdFilter
from app.main import create_app


@pytest.fixture(autouse=True)
def _isolated_settings(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Keep tests independent of the developer's shell and backend/.env."""
    monkeypatch.setenv("ENV", "local")
    monkeypatch.setenv("LOG_LEVEL", "INFO")
    monkeypatch.setenv("FIREBASE_AUTH_EMULATOR_HOST", "")
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

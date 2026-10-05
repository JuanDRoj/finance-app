import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import Settings, get_settings
from app.export_openapi import render_openapi
from app.main import create_app

DOC_PATHS = ["/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"]


async def _status_codes(paths: list[str]) -> dict[str, int]:
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        return {path: (await client.get(path)).status_code for path in paths}


async def test_docs_are_served_when_env_is_local() -> None:
    codes = await _status_codes(["/docs", "/redoc", "/openapi.json"])

    assert codes == {"/docs": 200, "/redoc": 200, "/openapi.json": 200}


async def test_docs_are_served_when_env_is_not_set(monkeypatch: pytest.MonkeyPatch) -> None:
    # Same default as Settings.ENV.
    monkeypatch.delenv("ENV")

    codes = await _status_codes(["/docs", "/redoc", "/openapi.json"])

    assert codes == {"/docs": 200, "/redoc": 200, "/openapi.json": 200}


@pytest.mark.parametrize("env", ["staging", "prod", "production", "LOCAL", ""])
async def test_docs_are_not_served_outside_local(monkeypatch: pytest.MonkeyPatch, env: str) -> None:
    # Fails closed: anything that is not exactly "local" hides the docs, even an invalid value.
    monkeypatch.setenv("ENV", env)

    codes = await _status_codes(DOC_PATHS)

    assert codes == dict.fromkeys(DOC_PATHS, 404)


async def test_the_api_keeps_working_when_the_docs_are_hidden(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENV", "prod")

    assert (await _status_codes(["/healthz"])) == {"/healthz": 200}


def test_the_exported_schema_does_not_depend_on_env(monkeypatch: pytest.MonkeyPatch) -> None:
    local = render_openapi(create_app())
    monkeypatch.setenv("ENV", "prod")

    assert render_openapi(create_app()) == local


def test_create_app_does_not_build_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    def forbidden(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("create_app must not build Settings")

    monkeypatch.setattr(Settings, "__init__", forbidden)
    monkeypatch.setattr("app.main.get_settings", forbidden)
    monkeypatch.setenv("ENV", "prod")

    create_app()  # no DATABASE_URL either: building Settings here would fail


@pytest.mark.usefixtures("restore_root_logger")
async def test_lifespan_refuses_to_start_if_docs_are_on_but_settings_say_not_local(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # ENV reaches Settings through a source create_app does not read (e.g. a .env file).
    app = create_app()
    monkeypatch.setenv("ENV", "staging")
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@localhost:5432/x")
    get_settings.cache_clear()

    with pytest.raises(RuntimeError, match="docs"):
        async with app.router.lifespan_context(app):
            pytest.fail("the app must not start")


@pytest.mark.usefixtures("restore_root_logger")
async def test_lifespan_starts_when_docs_are_off_outside_local(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENV", "staging")
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@localhost:5432/x")
    get_settings.cache_clear()
    app = create_app()

    async with app.router.lifespan_context(app):
        assert app.openapi_url is None

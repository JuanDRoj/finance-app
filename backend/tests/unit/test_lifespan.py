"""The `lifespan`: what it builds on startup, what it releases, and when it refuses to start."""

import firebase_admin
import pytest
from fastapi import FastAPI

from app.core.config import get_settings
from app.main import create_app
from app.modules.auth.firebase import FirebaseAdminAuth


class _AppFailed(Exception):
    def __init__(self, adapter: FirebaseAdminAuth) -> None:
        super().__init__("the app failed while running")
        self.adapter = adapter


def _assert_released(adapter: FirebaseAdminAuth) -> None:
    with pytest.raises(ValueError, match="does not exist"):
        firebase_admin.get_app(adapter.app.name)


@pytest.mark.usefixtures("restore_root_logger")
async def test_lifespan_creates_the_firebase_adapter_and_closes_it_on_shutdown(
    app: FastAPI,
) -> None:
    async with app.router.lifespan_context(app):
        adapter = app.state.firebase
        assert isinstance(adapter, FirebaseAdminAuth)
        assert firebase_admin.get_app(adapter.app.name) is adapter.app
        assert adapter.app.project_id == "demo-finance-local"
    _assert_released(adapter)


@pytest.mark.usefixtures("restore_root_logger")
async def test_lifespan_closes_the_firebase_adapter_when_the_app_fails(app: FastAPI) -> None:
    async def run_and_fail() -> None:
        async with app.router.lifespan_context(app):
            adapter = app.state.firebase
            raise _AppFailed(adapter)

    with pytest.raises(_AppFailed) as exc:
        await run_and_fail()
    _assert_released(exc.value.adapter)


@pytest.mark.usefixtures("restore_root_logger")
async def test_lifespan_refuses_to_start_on_cloud_run_with_env_local(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Cloud Run always defines K_SERVICE. An ENV that was forgotten there defaults to "local",
    # which would open the docs, the emulator and cookies without Secure in a real deployment.
    monkeypatch.setenv("K_SERVICE", "finance-api")

    with pytest.raises(RuntimeError, match="K_SERVICE") as exc:
        async with app.router.lifespan_context(app):
            pytest.fail("the app must not start")

    assert "ENV" in str(exc.value)
    assert not hasattr(app.state, "firebase")


@pytest.mark.usefixtures("restore_root_logger")
async def test_lifespan_refuses_to_start_on_cloud_run_when_env_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("K_SERVICE", "finance-api")
    monkeypatch.delenv("ENV")
    get_settings.cache_clear()
    app = create_app()

    with pytest.raises(RuntimeError, match="K_SERVICE"):
        async with app.router.lifespan_context(app):
            pytest.fail("the app must not start")


@pytest.mark.usefixtures("restore_root_logger")
async def test_lifespan_starts_on_cloud_run_with_a_real_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("K_SERVICE", "finance-api")
    monkeypatch.setenv("ENV", "staging")
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@localhost:5432/x")
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "finance-staging")
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://app.example.com")
    get_settings.cache_clear()
    app = create_app()

    async with app.router.lifespan_context(app):
        assert isinstance(app.state.firebase, FirebaseAdminAuth)


@pytest.mark.usefixtures("restore_root_logger")
async def test_lifespan_starts_with_env_local_outside_cloud_run(app: FastAPI) -> None:
    # K_SERVICE is not defined (the autouse fixture removes it): a developer machine or the CI.
    async with app.router.lifespan_context(app):
        assert isinstance(app.state.firebase, FirebaseAdminAuth)

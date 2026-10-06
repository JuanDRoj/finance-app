import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.config import docs_enabled, get_settings, running_on_cloud_run
from app.core.db import Database
from app.core.errors import register_exception_handlers
from app.core.logging import RequestIdMiddleware, configure_logging
from app.health import router as health_router
from app.modules.auth.firebase import create_firebase_auth
from app.modules.auth.router import router as auth_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    # Runs after uvicorn applies its own log config (`fastapi run` and `fastapi dev`),
    # so our JSON handler is the one that stays installed.
    configure_logging(settings.LOG_LEVEL, settings.GOOGLE_CLOUD_PROJECT)
    if settings.ENV != "local" and app.openapi_url is not None:
        # `create_app` decided from os.environ; Settings (which also reads .env) disagrees.
        raise RuntimeError(
            f"The API docs are enabled but ENV is {settings.ENV!r}: set ENV in the process "
            "environment, not only in a .env file. Refusing to start."
        )
    if settings.ENV == "local" and running_on_cloud_run():
        # ENV defaults to "local" when it is missing, which in a real deployment would open the
        # docs, the Firebase emulator and cookies without Secure. Cloud Run always sets K_SERVICE.
        raise RuntimeError(
            "ENV is 'local' (or not set) but K_SERVICE is defined, so this is Cloud Run: set ENV "
            "to 'staging' or 'prod' on the service. Refusing to start."
        )
    if settings.ENV != "local" and not settings.GOOGLE_CLOUD_PROJECT:
        logger.warning("gcp_project_not_set")  # logs cannot be linked to Cloud Run requests
    # The engine opens no connection here, so the app starts (and /healthz answers) even
    # if the database is down.
    app.state.db = await Database.create(settings)
    try:
        # Opens no connection either: firebase-admin only talks to Google on the first login.
        app.state.firebase = create_firebase_auth(settings)
        try:
            yield
        finally:
            app.state.firebase.close()
    finally:
        await app.state.db.dispose()


def create_app() -> FastAPI:
    docs = docs_enabled()
    app = FastAPI(
        title="Personal Finance App",
        lifespan=lifespan,
        # Routes have no trailing slash. A request that adds one gets a plain 404, not a 307
        # (whose Location may come out as http:// behind Cloud Run's TLS termination).
        redirect_slashes=False,
        docs_url="/docs" if docs else None,
        redoc_url="/redoc" if docs else None,
        openapi_url="/openapi.json" if docs else None,
    )
    app.add_middleware(RequestIdMiddleware)
    register_exception_handlers(app)
    app.include_router(health_router)
    app.include_router(auth_router)
    return app


app = create_app()

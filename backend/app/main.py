from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.config import get_settings
from app.core.db import Database
from app.core.logging import RequestIdMiddleware, configure_logging
from app.health import router as health_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    # Runs after uvicorn applies its own log config (`fastapi run` and `fastapi dev`),
    # so our JSON handler is the one that stays installed.
    configure_logging(settings.LOG_LEVEL)
    # The engine opens no connection here, so the app starts (and /healthz answers) even
    # if the database is down.
    app.state.db = await Database.create(settings)
    try:
        yield
    finally:
        await app.state.db.dispose()


def create_app() -> FastAPI:
    app = FastAPI(title="Personal Finance App", lifespan=lifespan)
    app.add_middleware(RequestIdMiddleware)
    app.include_router(health_router)
    return app


app = create_app()

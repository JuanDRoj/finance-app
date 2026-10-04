from fastapi import FastAPI

from app.core.config import get_settings
from app.core.logging import RequestIdMiddleware, configure_logging
from app.health import router as health_router


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.LOG_LEVEL)
    app = FastAPI(title="Personal Finance App")
    app.add_middleware(RequestIdMiddleware)
    app.include_router(health_router)
    return app


app = create_app()

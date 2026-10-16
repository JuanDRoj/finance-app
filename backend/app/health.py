from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Liveness probe: no database or external dependencies. Use this one on Cloud Run."""
    return HealthResponse(status="ok")


@router.get("/healthz", response_model=HealthResponse)
async def healthz() -> HealthResponse:
    """Same as /health, kept for local use only.

    Do not use it on Cloud Run: paths ending in `z` are reserved there and the platform answers
    them with its own 404 before the request reaches the app. Use /health instead.
    """
    return HealthResponse(status="ok")

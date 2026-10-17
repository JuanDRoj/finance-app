from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str


# No `/healthz` alias: Cloud Run reserves paths ending in `z` and answers them with its own 404
# before the request reaches the app.
@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Liveness probe: no database or external dependencies."""
    return HealthResponse(status="ok")

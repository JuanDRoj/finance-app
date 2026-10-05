from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.currencies.models import Currency


async def get(session: AsyncSession, code: str) -> Currency | None:
    return await session.get(Currency, code)


async def list_all(session: AsyncSession) -> list[Currency]:
    result = await session.scalars(select(Currency).order_by(Currency.code))
    return list(result)

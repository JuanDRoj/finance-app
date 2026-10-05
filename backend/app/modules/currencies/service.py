from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import InvalidFieldError
from app.modules.currencies import repository
from app.modules.currencies.schemas import CurrencyRead


async def get_currency(session: AsyncSession, code: str) -> CurrencyRead:
    currency = await repository.get(session, code)
    if currency is None:
        raise InvalidFieldError(
            ("body", "currency"), "currency_unsupported", "Unsupported currency"
        )
    return CurrencyRead.model_validate(currency)


async def list_currencies(session: AsyncSession) -> list[CurrencyRead]:
    return [CurrencyRead.model_validate(c) for c in await repository.list_all(session)]

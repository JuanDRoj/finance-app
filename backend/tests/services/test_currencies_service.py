import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import InvalidFieldError
from app.modules.currencies import service
from app.modules.currencies.schemas import CurrencyRead


async def test_get_currency_returns_the_two_decimal_exponent(session: AsyncSession) -> None:
    assert await service.get_currency(session, "UYU") == CurrencyRead(code="UYU", exponent=2)


async def test_get_currency_returns_exponent_zero_for_clp(session: AsyncSession) -> None:
    assert (await service.get_currency(session, "CLP")).exponent == 0


async def test_unknown_currency_is_a_422_field_error(session: AsyncSession) -> None:
    with pytest.raises(InvalidFieldError) as exc:
        await service.get_currency(session, "XXX")

    assert exc.value.code == "currency_unsupported"
    assert exc.value.loc == ["body", "currency"]


async def test_list_currencies_returns_all_sorted_by_code(session: AsyncSession) -> None:
    result = await service.list_currencies(session)

    codes = [c.code for c in result]
    assert codes == sorted(codes)
    assert {"UYU", "COP", "USD", "CLP", "PYG"} <= set(codes)

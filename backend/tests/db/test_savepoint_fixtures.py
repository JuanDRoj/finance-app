from collections.abc import Callable

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.db import Database


async def test_commit_in_a_test_session_is_not_visible_to_other_connections(
    session: AsyncSession, settings_factory: Callable[..., Settings]
) -> None:
    await session.execute(text("INSERT INTO currencies (code, exponent) VALUES ('ZZZ', 2)"))
    await session.commit()
    assert (
        await session.execute(text("SELECT count(*) FROM currencies WHERE code='ZZZ'"))
    ).scalar_one() == 1

    other = await Database.create(settings_factory(), null_pool=True)
    try:
        async with other.sessionmaker() as s:
            count = (
                await s.execute(text("SELECT count(*) FROM currencies WHERE code='ZZZ'"))
            ).scalar_one()
        assert count == 0
    finally:
        await other.dispose()

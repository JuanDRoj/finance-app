import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.categories import service as categories_service
from app.modules.dashboard.schemas import DashboardRead, TopExpenseCategory
from app.modules.dashboard.top_expenses import percentage, top_main_categories
from app.modules.spaces import service as spaces_service
from app.modules.transactions import service as transactions_service


async def get_dashboard(
    session: AsyncSession, space_id: uuid.UUID, *, now: datetime
) -> DashboardRead:
    """Available, card debt and net of the space plus the top of the current month's expenses.

    The balances are `transactions.service.get_balance_summary` as it is: the same rule and the
    same code as `balance-summary`, so the home screen can never disagree with it. The current
    month is the one `now` falls in once converted to the timezone of the space (`now` comes from
    the router, aware and in UTC, so tests choose it); every day of that month counts, also the
    ones after today, like the month filter of the movements list. The expenses of the month come
    per category from `transactions` (the owner of the entries) and are rolled up to the main
    category here, with the names and icons from `categories`: archived categories included, as
    old movements keep them.

    The queries run one after the other on the session of the request (a session is not shared
    between tasks): the timezone, the balances (two), the expenses and the categories, whatever
    the size of the data. Each one reads what is committed when it runs, so a movement saved
    between two of them can show in one figure and not yet in another; they are independent
    figures and the next request agrees.
    """
    timezone = await spaces_service.get_space_timezone(session, space_id)
    local = now.astimezone(ZoneInfo(timezone))
    month = f"{local.year:04d}-{local.month:02d}"
    balances = await transactions_service.get_balance_summary(session, space_id)
    spent = await transactions_service.get_expense_by_category(session, space_id, month)
    category_reads = await categories_service.list_category_reads(
        session, space_id, include_archived=True
    )
    ranked = top_main_categories(spent, {c.id: c for c in category_reads})
    total = sum(spent.values())
    return DashboardRead(
        month=month,
        available_minor=balances.available_minor,
        card_debt_minor=balances.card_debt_minor,
        net_minor=balances.net_minor,
        month_expense_minor=total,
        top_expense_categories=[
            TopExpenseCategory(
                category_id=row.category.id,
                name=row.category.name,
                icon=row.category.icon,
                amount_minor=row.amount_minor,
                percentage=percentage(row.amount_minor, total),
            )
            for row in ranked
        ],
    )

import uuid

from app.core.schemas import ReadModel
from app.modules.categories.schemas import CategoryIcon
from app.modules.transactions.schemas import Month


class TopExpenseCategory(ReadModel):
    """A main category in the top of the month, with its subcategories added in.

    `category_id` is the main category: filtering the movements by it (`category_id` of the list)
    includes its subcategories, so the movements it leads to add up to `amount_minor`.
    `percentage` is a whole percent of `DashboardRead.month_expense_minor`, rounded to the nearest
    with the half up (12.5 is 13): the rows of the top need not add up to 100.
    """

    category_id: uuid.UUID
    name: str
    icon: CategoryIcon
    amount_minor: int  # positive: what was spent
    percentage: int


class DashboardRead(ReadModel):
    """What the home screen shows, in the minor unit of the currency of the space.

    `available_minor`, `card_debt_minor` and `net_minor` are those of `balance-summary`: all the
    accounts of the space, archived ones included, counting only confirmed movements that are not
    deleted. `month` is the current month in the timezone of the space (`YYYY-MM`, the filter of
    the movements list), and `month_expense_minor` is everything spent in it: the confirmed,
    not deleted expenses of any category (adjustments, transfers, incomes, pending and skipped
    movements do not count). It is the same `expense_minor` the movements summary gives for that
    month, and the denominator of the percentages. `top_expense_categories` has up to five main
    categories, largest first; what is left up to `month_expense_minor` is "Otros" for whoever
    wants to draw it.
    """

    month: Month
    available_minor: int  # bank and cash
    card_debt_minor: int  # positive = the cards are owed; not clamped
    net_minor: int  # available - debt = the sum of every balance
    month_expense_minor: int
    top_expense_categories: list[TopExpenseCategory]

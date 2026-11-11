import uuid
from typing import Annotated

from pydantic import Field

from app.core.schemas import InputModel, ReadModel
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


# The home charts show six months; a client can ask for up to a year.
DEFAULT_SERIES_MONTHS = 6
MAX_SERIES_MONTHS = 12


class SeriesParams(InputModel):
    """The query of the series: how many months, counting the current one. Unknown ones are 422."""

    months: Annotated[int, Field(ge=1, le=MAX_SERIES_MONTHS)] = DEFAULT_SERIES_MONTHS


class MonthlySeriesPoint(ReadModel):
    """One month of the series, in the minor unit of the currency of the space.

    `income_minor` and `expense_minor` (both positive) are the confirmed, not deleted incomes and
    expenses of the whole month, also the days after today in the current one (adjustments,
    transfers, pending, skipped and deleted movements do not count): the same figures the
    movements summary gives for that `month`. A month without movements has 0 in both.

    `net_minor` is the net (available - card debt = the sum of every balance) at the close of the
    month; in the current month, the net of today, the same as `DashboardRead.net_minor`. It does
    count adjustments (the initial balance and the reconciliations are balance) and it does not
    count pending, skipped and deleted movements. A month without movements keeps the net of the
    month before, and the months before the first movement are 0.
    """

    month: Month
    income_minor: int
    expense_minor: int
    net_minor: int


class DashboardSeriesRead(ReadModel):
    """The months of the home charts, oldest first; the last one is the current month.

    There are exactly as many points as the `months` asked, ending in the current month of the
    space (in its timezone), whatever the movements are. The amounts are in the minor unit of the
    currency of the space (`SpaceRead.currency`, as everywhere else in the API).
    """

    points: list[MonthlySeriesPoint]

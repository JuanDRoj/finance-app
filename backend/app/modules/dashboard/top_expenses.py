"""The top of expenses by main category. Pure functions: no session, no database.

`transactions` gives what was spent per category as it was classified (a subcategory is its own
key) and `categories` knows the tree; this module only does the arithmetic of the dashboard: roll
every subcategory up to its main category, rank them and round the share of each one.
"""

import uuid
from collections.abc import Mapping
from dataclasses import dataclass

from app.modules.categories.schemas import CategoryRead

# The dashboard shows the five main categories where the most was spent in the month.
TOP_LIMIT = 5


@dataclass(frozen=True, slots=True)
class RankedCategory:
    """A main category and everything spent in it and in its subcategories, as a positive amount."""

    category: CategoryRead
    amount_minor: int


def percentage(part: int, total: int) -> int:
    """`part` as a whole percent of `total`, rounded to the nearest and the half goes up.

    Integers only, never a float: `floor(100 * part / total + 1/2)` written as
    `(200 * part + total) // (2 * total)`, so 12.5 is 13 and 0.5 is 1 whatever the size of the
    amounts (a float would lose the half near 2^53). `total` must be positive.
    """
    if total <= 0:
        raise ValueError("The total must be positive")
    return (200 * part + total) // (2 * total)


def top_main_categories(
    spent: Mapping[uuid.UUID | None, int],
    categories: Mapping[uuid.UUID, CategoryRead],
    limit: int = TOP_LIMIT,
) -> list[RankedCategory]:
    """The `limit` main categories with the most spending, largest first.

    `spent` is the amount per category id, as `transactions` gives it; a subcategory adds to its
    main category (`parent_id`; the database allows two levels and no more), together with what
    was spent directly in the main one. `categories` holds every category of the space, archived
    ones too: an old movement keeps its category and the money was spent all the same. Every id of
    `spent` is in `categories` (composite foreign key of `entries`). Spending without a category
    (`None` key; the API never writes it) has no row to show and is left out. Equal amounts are
    ordered by the id of the main category, which grows with its creation (UUIDv7), so the order
    never changes between requests. Fewer categories than `limit` give fewer rows.
    """
    per_main: dict[uuid.UUID, int] = {}
    for category_id, amount in spent.items():
        if category_id is None:
            continue
        category = categories[category_id]
        main_id = category.id if category.parent_id is None else category.parent_id
        per_main[main_id] = per_main.get(main_id, 0) + amount
    ranked = sorted(per_main.items(), key=lambda item: (-item[1], item[0]))
    return [RankedCategory(categories[main_id], amount) for main_id, amount in ranked[:limit]]

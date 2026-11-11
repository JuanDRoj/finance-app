"""The top of expenses by main category: rounding and ranking, pure functions without a database."""

import uuid
from itertools import pairwise

import pytest

from app.core.schemas import MAX_SAFE_INTEGER
from app.modules.categories.schemas import CategoryRead
from app.modules.dashboard.top_expenses import TOP_LIMIT, percentage, top_main_categories


def _category(
    name: str, *, parent: CategoryRead | None = None, archived: bool = False
) -> CategoryRead:
    return CategoryRead.model_validate(
        {
            "id": uuid.uuid7(),
            "parent_id": parent.id if parent is not None else None,
            "name": name,
            "kind": "expense",
            "icon": "tag",
            "archived_at": "2026-01-01T00:00:00Z" if archived else None,
        }
    )


def _by_id(*categories: CategoryRead) -> dict[uuid.UUID, CategoryRead]:
    return {category.id: category for category in categories}


# percentage -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("part", "total", "expected"),
    [
        (1, 4, 25),
        (1, 3, 33),
        (2, 3, 67),
        (5, 5, 100),
        (0, 7, 0),
        (1, 8, 13),  # 12.5 exactly: the half goes up
        (1, 200, 1),  # 0.5 exactly
        (3, 200, 2),  # 1.5 exactly
        (1, 201, 0),  # just below the half
        (199, 200, 100),  # 99.5 exactly rounds to 100
        (199, 201, 99),  # 99.004...
    ],
)
def test_percentage_rounds_to_the_nearest_whole_percent_and_the_half_goes_up(
    part: int, total: int, expected: int
) -> None:
    assert percentage(part, total) == expected


def test_percentage_is_exact_with_amounts_near_the_safe_limit() -> None:
    # 12.5 % of 8e15 + 8 is exactly 1e15 + 1: a float would not see the half at this size.
    total = 8 * 10**15 + 8
    assert percentage(10**15 + 1, total) == 13
    assert percentage(10**15, total) == 12
    assert percentage(MAX_SAFE_INTEGER, 2 * MAX_SAFE_INTEGER) == 50
    assert percentage(MAX_SAFE_INTEGER, MAX_SAFE_INTEGER) == 100


def test_percentage_returns_an_int_never_a_float() -> None:
    assert type(percentage(1, 3)) is int


# top_main_categories --------------------------------------------------------------------------


def test_the_limit_is_five() -> None:
    assert TOP_LIMIT == 5


def test_no_spending_gives_an_empty_top() -> None:
    assert top_main_categories({}, {}) == []


def test_a_subcategory_adds_to_its_main_category_together_with_the_spending_of_the_main_one() -> (
    None
):
    food = _category("Comida")
    market = _category("Supermercado", parent=food)
    restaurants = _category("Restaurantes", parent=food)
    transport = _category("Transporte")
    categories = _by_id(food, market, restaurants, transport)

    top = top_main_categories(
        {food.id: 100, market.id: 250, restaurants.id: 50, transport.id: 300}, categories
    )

    assert [(r.category.id, r.amount_minor) for r in top] == [
        (food.id, 400),
        (transport.id, 300),
    ]


def test_the_top_is_ordered_from_the_largest_to_the_smallest() -> None:
    a, b, c = _category("A"), _category("B"), _category("C")

    top = top_main_categories({a.id: 10, b.id: 30, c.id: 20}, _by_id(a, b, c))

    assert [r.category.id for r in top] == [b.id, c.id, a.id]


def test_only_the_five_largest_are_kept() -> None:
    categories = [_category(f"C{i}") for i in range(7)]
    spent: dict[uuid.UUID | None, int] = {
        category.id: (i + 1) * 100 for i, category in enumerate(categories)
    }

    top = top_main_categories(spent, _by_id(*categories))

    assert len(top) == 5
    assert [r.amount_minor for r in top] == [700, 600, 500, 400, 300]
    assert all(a.amount_minor >= b.amount_minor for a, b in pairwise(top))


def test_fewer_than_five_categories_give_fewer_rows() -> None:
    a, b = _category("A"), _category("B")

    top = top_main_categories({a.id: 1, b.id: 2}, _by_id(a, b))

    assert len(top) == 2


def test_the_subcategories_count_before_the_cut() -> None:
    """Six main categories where the smallest alone loses to a big subcategory of another one."""
    mains = [_category(f"M{i}") for i in range(6)]
    sub = _category("Sub", parent=mains[5])
    spent: dict[uuid.UUID | None, int] = {m.id: 100 for m in mains[:5]}
    spent[mains[5].id] = 10
    spent[sub.id] = 500

    top = top_main_categories(spent, _by_id(*mains, sub))

    assert top[0].category.id == mains[5].id
    assert top[0].amount_minor == 510
    assert len(top) == 5


def test_equal_amounts_are_ordered_by_the_id_of_the_main_category() -> None:
    older, newer = _category("Older"), _category("Newer")  # UUIDv7 grows with creation

    top = top_main_categories({newer.id: 100, older.id: 100}, _by_id(newer, older))

    assert [r.category.id for r in top] == [older.id, newer.id]


def test_spending_without_a_category_is_left_out_of_the_top() -> None:
    a = _category("A")

    top = top_main_categories({None: 999, a.id: 1}, _by_id(a))

    assert [(r.category.id, r.amount_minor) for r in top] == [(a.id, 1)]


def test_archived_categories_still_count_under_their_main_one() -> None:
    food = _category("Comida", archived=True)
    old = _category("Viejo", parent=food, archived=True)

    top = top_main_categories({old.id: 70}, _by_id(food, old))

    assert [(r.category.id, r.amount_minor) for r in top] == [(food.id, 70)]
    assert top[0].category.archived_at is not None


def test_the_row_is_the_main_category_never_the_subcategory() -> None:
    food = _category("Comida")
    market = _category("Supermercado", parent=food)

    [row] = top_main_categories({market.id: 5}, _by_id(food, market))

    assert row.category.name == "Comida"
    assert row.category.parent_id is None

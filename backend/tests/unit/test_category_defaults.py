"""The predefined categories (approved in KAN-65) and the fixed icon list, without a database."""

import re
from collections import Counter

from app.modules.categories.defaults import DEFAULT_CATEGORIES
from app.modules.categories.icons import CATEGORY_ICONS

KEBAB = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def _names(items: list[str]) -> list[str]:
    return [item.casefold() for item in items]


def test_the_icon_list_has_66_unique_keys_in_kebab_case() -> None:
    assert len(CATEGORY_ICONS) == 66
    assert len(set(CATEGORY_ICONS)) == 66
    assert all(KEBAB.match(key) and len(key) <= 40 for key in CATEGORY_ICONS)


def test_there_are_15_main_categories_and_19_subcategories() -> None:
    assert len(DEFAULT_CATEGORIES) == 15
    assert sum(len(main.children) for main in DEFAULT_CATEGORIES) == 19


def test_there_are_ten_expense_and_five_income_main_categories() -> None:
    kinds = Counter(main.kind for main in DEFAULT_CATEGORIES)

    assert kinds == {"expense": 10, "income": 5}


def test_every_default_uses_an_icon_of_the_fixed_list() -> None:
    icons = [main.icon for main in DEFAULT_CATEGORIES]
    icons += [sub.icon for main in DEFAULT_CATEGORIES for sub in main.children]

    assert set(icons) <= set(CATEGORY_ICONS)


def test_the_five_names_of_the_design_canvas_are_expense_categories() -> None:
    expense = [main.name for main in DEFAULT_CATEGORIES if main.kind == "expense"]

    assert expense[:5] == ["Comida", "Transporte", "Hogar", "Salud", "Ocio"]


def test_main_names_are_unique_within_each_kind_ignoring_case() -> None:
    for kind in ("expense", "income"):
        names = _names([main.name for main in DEFAULT_CATEGORIES if main.kind == kind])
        assert len(names) == len(set(names)), kind


def test_subcategory_names_are_unique_within_their_main_ignoring_case() -> None:
    for main in DEFAULT_CATEGORIES:
        names = _names([sub.name for sub in main.children])
        assert len(names) == len(set(names)), main.name


def test_every_name_is_trimmed_not_blank_and_at_most_80_characters() -> None:
    names = [main.name for main in DEFAULT_CATEGORIES]
    names += [sub.name for main in DEFAULT_CATEGORIES for sub in main.children]

    assert all(name == name.strip() and 0 < len(name) <= 80 for name in names)


def test_the_defaults_are_immutable() -> None:
    assert isinstance(DEFAULT_CATEGORIES, tuple)
    assert all(isinstance(main.children, tuple) for main in DEFAULT_CATEGORIES)

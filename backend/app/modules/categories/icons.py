"""The fixed list of icons a category can have: Phosphor icon names in kebab-case.

`CategoryIcon` is the single source of truth. The API schemas use it as a `Literal`, so OpenAPI
publishes it as an `enum` and the frontend gets a TypeScript union (its map from key to Phosphor
component is then checked by the compiler). The database only checks the *shape* of the key
(`ck_categories_icon_format`), not the list, so adding an icon needs no migration.

The key is the Phosphor name; the React component is the same name in PascalCase (`fork-knife` ->
`ForkKnife`, `t-shirt` -> `TShirt`).

The list only grows: an icon is never removed or renamed, because categories already saved (and
`CategoryRead`) use it. To add one, append it here and the frontend adds it to its map.
"""

from typing import Literal, get_args

CategoryIcon = Literal[
    # Food and shopping
    "fork-knife",
    "bowl-food",
    "pizza",
    "hamburger",
    "coffee",
    "beer-stein",
    "wine",
    "cake",
    "shopping-cart",
    "basket",
    "shopping-bag",
    "storefront",
    # Transport
    "car",
    "gas-pump",
    "bus",
    "taxi",
    "train",
    "motorcycle",
    "bicycle",
    "airplane-tilt",
    # Home and services
    "house",
    "key",
    "bed",
    "lightbulb",
    "lightning",
    "drop",
    "device-mobile",
    "wifi-high",
    "wrench",
    "hammer",
    "plant",
    # Health and personal care
    "heartbeat",
    "stethoscope",
    "pill",
    "first-aid-kit",
    "tooth",
    "barbell",
    "scissors",
    "heart",
    # Leisure
    "game-controller",
    "popcorn",
    "music-notes",
    "monitor-play",
    "martini",
    "suitcase",
    "tent",
    # Education, family and gifts
    "graduation-cap",
    "book-open",
    "baby",
    "paw-print",
    "dog",
    "gift",
    "t-shirt",
    # Money and work
    "briefcase",
    "laptop",
    "money",
    "coins",
    "wallet",
    "bank",
    "piggy-bank",
    "receipt",
    "chart-line-up",
    "percent",
    "star",
    "tag",
    "dots-three-circle",
]

CATEGORY_ICONS: tuple[str, ...] = get_args(CategoryIcon)

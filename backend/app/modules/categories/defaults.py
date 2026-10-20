"""The predefined categories every personal space starts with (approved in KAN-65).

Spanish names, each with an icon of the fixed list. The order here is the order of creation, and
the API lists categories in creation order, so this is the order users see. Subcategories inherit
the kind of their main category.

Migration `0004_create_categories` carries its own frozen copy of this list for the spaces that
existed back then; changing this list only affects the spaces created from now on.
"""

from dataclasses import dataclass

from app.modules.categories.icons import CategoryIcon
from app.modules.categories.schemas import CategoryKind


@dataclass(frozen=True)
class DefaultSubcategory:
    name: str
    icon: CategoryIcon


@dataclass(frozen=True)
class DefaultCategory:
    name: str
    kind: CategoryKind
    icon: CategoryIcon
    children: tuple[DefaultSubcategory, ...] = ()


DEFAULT_CATEGORIES: tuple[DefaultCategory, ...] = (
    # Expenses
    DefaultCategory(
        "Comida",
        "expense",
        "fork-knife",
        (
            DefaultSubcategory("Supermercado", "shopping-cart"),
            DefaultSubcategory("Restaurantes", "bowl-food"),
            DefaultSubcategory("Cafés", "coffee"),
        ),
    ),
    DefaultCategory(
        "Transporte",
        "expense",
        "car",
        (
            DefaultSubcategory("Combustible", "gas-pump"),
            DefaultSubcategory("Transporte público", "bus"),
            DefaultSubcategory("Taxi y apps", "taxi"),
        ),
    ),
    DefaultCategory(
        "Hogar",
        "expense",
        "house",
        (
            DefaultSubcategory("Alquiler", "key"),
            DefaultSubcategory("Servicios", "lightbulb"),
            DefaultSubcategory("Internet y celular", "wifi-high"),
        ),
    ),
    DefaultCategory(
        "Salud",
        "expense",
        "heartbeat",
        (
            DefaultSubcategory("Consultas", "stethoscope"),
            DefaultSubcategory("Medicamentos", "pill"),
        ),
    ),
    DefaultCategory(
        "Ocio",
        "expense",
        "game-controller",
        (
            DefaultSubcategory("Salidas", "martini"),
            DefaultSubcategory("Suscripciones", "monitor-play"),
            DefaultSubcategory("Viajes", "airplane-tilt"),
        ),
    ),
    DefaultCategory("Educación", "expense", "graduation-cap"),
    DefaultCategory("Ropa", "expense", "t-shirt"),
    DefaultCategory("Mascotas", "expense", "paw-print"),
    DefaultCategory("Regalos", "expense", "gift"),
    DefaultCategory("Otros gastos", "expense", "dots-three-circle"),
    # Income
    DefaultCategory(
        "Trabajo",
        "income",
        "briefcase",
        (
            DefaultSubcategory("Sueldo", "money"),
            DefaultSubcategory("Bonos y aguinaldo", "star"),
            DefaultSubcategory("Trabajos extra", "laptop"),
        ),
    ),
    DefaultCategory(
        "Inversiones",
        "income",
        "chart-line-up",
        (
            DefaultSubcategory("Intereses", "percent"),
            DefaultSubcategory("Dividendos", "coins"),
        ),
    ),
    DefaultCategory("Ventas", "income", "tag"),
    DefaultCategory("Regalos recibidos", "income", "gift"),
    DefaultCategory("Otros ingresos", "income", "dots-three-circle"),
)

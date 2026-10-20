"""create categories

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-20

`categories`: two levels (principal and subcategory) with a Phosphor icon key. The structure is
enforced by the database, not only by the API:

- `is_main` and `has_parent` are generated from `parent_id`.
- A subcategory points at `(id, space_id, kind, is_main)` of its parent with
  `(parent_id, space_id, kind, has_parent)`, so the parent must be in the same space, have the same
  kind and be a principal category (no third level). A principal category has no parent, so that
  foreign key is not checked for it.
- Names are unique among siblings, ignoring case and counting the archived ones: one partial unique
  index for principal categories (per space and kind) and one for subcategories (per parent).
- `icon` only has its shape checked (kebab-case key); the list of icons lives in the API.

The data part gives the predefined categories to every space that already exists (staging has test
accounts). It carries its own frozen copy of the list, so a later change to the list in
`app/modules/categories/defaults.py` never alters what this revision did. Ids are UUIDv7 in list
order, like the ones the app generates. It reads the existing spaces, so it cannot be rendered
offline (`--sql`). The downgrade drops the table, so it also drops the categories (the spaces are
not touched).
"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | Sequence[str] | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (name, kind, icon, ((subcategory name, icon), ...)). Frozen on 2026-10-20 (KAN-65).
_PREDEFINED: tuple[tuple[str, str, str, tuple[tuple[str, str], ...]], ...] = (
    (
        "Comida",
        "expense",
        "fork-knife",
        (("Supermercado", "shopping-cart"), ("Restaurantes", "bowl-food"), ("Cafés", "coffee")),
    ),
    (
        "Transporte",
        "expense",
        "car",
        (("Combustible", "gas-pump"), ("Transporte público", "bus"), ("Taxi y apps", "taxi")),
    ),
    (
        "Hogar",
        "expense",
        "house",
        (("Alquiler", "key"), ("Servicios", "lightbulb"), ("Internet y celular", "wifi-high")),
    ),
    ("Salud", "expense", "heartbeat", (("Consultas", "stethoscope"), ("Medicamentos", "pill"))),
    (
        "Ocio",
        "expense",
        "game-controller",
        (("Salidas", "martini"), ("Suscripciones", "monitor-play"), ("Viajes", "airplane-tilt")),
    ),
    ("Educación", "expense", "graduation-cap", ()),
    ("Ropa", "expense", "t-shirt", ()),
    ("Mascotas", "expense", "paw-print", ()),
    ("Regalos", "expense", "gift", ()),
    ("Otros gastos", "expense", "dots-three-circle", ()),
    (
        "Trabajo",
        "income",
        "briefcase",
        (("Sueldo", "money"), ("Bonos y aguinaldo", "star"), ("Trabajos extra", "laptop")),
    ),
    ("Inversiones", "income", "chart-line-up", (("Intereses", "percent"), ("Dividendos", "coins"))),
    ("Ventas", "income", "tag", ()),
    ("Regalos recibidos", "income", "gift", ()),
    ("Otros ingresos", "income", "dots-three-circle", ()),
)


def upgrade() -> None:
    if op.get_context().as_sql:
        # The data part reads the spaces that exist when the revision runs.
        raise RuntimeError(
            "Revision 0004 reads the existing spaces: it cannot be rendered with --sql"
        )
    op.create_table(
        "categories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("icon", sa.Text(), nullable=False),
        sa.Column(
            "is_main",
            sa.Boolean(),
            sa.Computed("parent_id IS NULL", persisted=True),
            nullable=False,
        ),
        sa.Column(
            "has_parent",
            sa.Boolean(),
            sa.Computed("parent_id IS NOT NULL", persisted=True),
            nullable=False,
        ),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("btrim(name) <> ''", name=op.f("ck_categories_name_not_blank")),
        sa.CheckConstraint(
            "icon ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(icon) <= 40",
            name=op.f("ck_categories_icon_format"),
        ),
        sa.CheckConstraint("kind IN ('expense', 'income')", name=op.f("ck_categories_kind")),
        sa.CheckConstraint("char_length(name) <= 80", name=op.f("ck_categories_name_length")),
        sa.ForeignKeyConstraint(
            ["parent_id", "space_id", "kind", "has_parent"],
            ["categories.id", "categories.space_id", "categories.kind", "categories.is_main"],
            name=op.f("fk_categories_parent_id_space_id_kind_has_parent_categories"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["space_id"],
            ["spaces.id"],
            name=op.f("fk_categories_space_id_spaces"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_categories")),
        sa.UniqueConstraint(
            "id", "space_id", "kind", "is_main", name=op.f("uq_categories_id_space_id_kind_is_main")
        ),
    )
    op.create_index(op.f("ix_categories_space_id"), "categories", ["space_id"], unique=False)
    op.create_index(
        "uq_categories_main_name",
        "categories",
        ["space_id", "kind", sa.literal_column("lower(name)")],
        unique=True,
        postgresql_where=sa.text("parent_id IS NULL"),
    )
    op.create_index(
        "uq_categories_sub_name",
        "categories",
        ["parent_id", sa.literal_column("lower(name)")],
        unique=True,
        postgresql_where=sa.text("parent_id IS NOT NULL"),
    )
    _give_the_predefined_categories_to_the_existing_spaces()


def _give_the_predefined_categories_to_the_existing_spaces() -> None:
    space_ids = op.get_bind().execute(sa.text("SELECT id FROM spaces ORDER BY created_at, id"))
    categories = sa.table(
        "categories",
        sa.column("id", sa.Uuid()),
        sa.column("space_id", sa.Uuid()),
        sa.column("parent_id", sa.Uuid()),
        sa.column("name", sa.Text()),
        sa.column("kind", sa.Text()),
        sa.column("icon", sa.Text()),
    )
    rows: list[dict[str, object]] = []
    for space_id in space_ids.scalars().all():
        mains: list[dict[str, object]] = []
        subs: list[dict[str, object]] = []
        for name, kind, icon, children in _PREDEFINED:
            main_id = uuid.uuid7()
            mains.append(
                {
                    "id": main_id,
                    "space_id": space_id,
                    "parent_id": None,
                    "name": name,
                    "kind": kind,
                    "icon": icon,
                }
            )
            subs.extend(
                {
                    "id": uuid.uuid7(),
                    "space_id": space_id,
                    "parent_id": main_id,
                    "name": sub_name,
                    "kind": kind,
                    "icon": sub_icon,
                }
                for sub_name, sub_icon in children
            )
        rows += mains + subs  # the principal categories first: a subcategory needs its parent
    if rows:
        op.bulk_insert(categories, rows)


def downgrade() -> None:
    op.drop_index(
        "uq_categories_sub_name",
        table_name="categories",
        postgresql_where=sa.text("parent_id IS NOT NULL"),
    )
    op.drop_index(
        "uq_categories_main_name",
        table_name="categories",
        postgresql_where=sa.text("parent_id IS NULL"),
    )
    op.drop_index(op.f("ix_categories_space_id"), table_name="categories")
    op.drop_table("categories")

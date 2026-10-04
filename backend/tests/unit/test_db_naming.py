import re

import pytest
from sqlalchemy import (
    CheckConstraint,
    Column,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    UniqueConstraint,
)
from sqlalchemy.exc import InvalidRequestError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.schema import CreateIndex, CreateTable

from app.core.db import NAMING_CONVENTION, Base

# Only used to compile DDL text: the engine never connects.
_DIALECT = create_async_engine("postgresql+asyncpg://").dialect


def _fresh_metadata() -> MetaData:
    """Same convention as the app's metadata, without touching `Base.metadata`."""
    return MetaData(naming_convention=Base.metadata.naming_convention)


def _ddl(table: Table) -> str:
    return str(CreateTable(table).compile(dialect=_DIALECT))


def _index_name(index: Index) -> str:
    ddl = str(CreateIndex(index).compile(dialect=_DIALECT))
    match = re.search(r"CREATE INDEX (\w+) ON", ddl)
    assert match is not None, ddl
    return match.group(1)


def test_base_metadata_uses_the_project_naming_convention() -> None:
    assert Base.metadata.naming_convention == NAMING_CONVENTION
    assert set(NAMING_CONVENTION) == {"pk", "fk", "uq", "ck", "ix"}


def test_primary_foreign_unique_and_check_constraints_get_predictable_names() -> None:
    metadata = _fresh_metadata()
    Table("parents", metadata, Column("id", Integer, primary_key=True))
    children = Table(
        "children",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("parent_id", Integer, ForeignKey("parents.id")),
        Column("template_id", Integer),
        Column("period", String),
        Column("amount_cents", Integer),
        UniqueConstraint("template_id", "period"),
        CheckConstraint("amount_cents >= 0", name="amount_non_negative"),
    )
    ddl = _ddl(children)
    assert "CONSTRAINT pk_children PRIMARY KEY" in ddl
    assert "CONSTRAINT fk_children_parent_id_parents FOREIGN KEY" in ddl
    assert "CONSTRAINT uq_children_template_id_period UNIQUE" in ddl
    assert "CONSTRAINT ck_children_amount_non_negative CHECK" in ddl


def test_indexes_get_predictable_names_including_every_column() -> None:
    metadata = _fresh_metadata()
    table = Table(
        "children",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("period", String),
        Column("template_id", Integer),
        Index(None, "period"),
        Index(None, "period", "template_id"),
    )
    names = sorted(_index_name(index) for index in table.indexes)
    assert names == ["ix_children_period", "ix_children_period_template_id"]


def test_check_constraint_without_a_name_is_rejected() -> None:
    def build_and_compile() -> str:
        table = Table(
            "children",
            _fresh_metadata(),
            Column("amount_cents", Integer),
            CheckConstraint("amount_cents >= 0"),
        )
        return _ddl(table)

    with pytest.raises(InvalidRequestError):
        build_and_compile()

"""How a stored transaction is shown in the list and the detail. Pure: no session, no database.

The entries hold the truth (account, signed amount, category); a movement shows them by type, with
the name and the icon of its account and category. One function per type, chosen with `match` and
closed with `assert_never`, like `build_entries` does for the opposite direction.
"""

import uuid
from collections.abc import Mapping
from typing import assert_never

from pydantic import TypeAdapter

from app.modules.accounts.schemas import AccountRead
from app.modules.categories.schemas import CategoryRead
from app.modules.transactions.models import Entry, Transaction
from app.modules.transactions.schemas import (
    AccountRef,
    CategoryParentRef,
    CategoryRef,
    MovementListItem,
    MovementRead,
    TransactionStatus,
    TransactionType,
)

# `Transaction.type` is a plain `str` for the ORM: validating it gives the `Literal` that lets mypy
# check the `match` below, and a clear error for a value the CHECK constraint should never allow.
_TYPE: TypeAdapter[TransactionType] = TypeAdapter(TransactionType)
_STATUS: TypeAdapter[TransactionStatus] = TypeAdapter(TransactionStatus)


def build_movement(
    transaction: Transaction,
    accounts: Mapping[uuid.UUID, AccountRead],
    categories: Mapping[uuid.UUID, CategoryRead],
) -> MovementRead:
    """The movement as the API shows it.

    `transaction.entries` must be loaded. `accounts` and `categories` must hold every account and
    category of the space, archived ones included (a movement keeps them): a missing one is a bug
    and raises `KeyError`.
    """
    kind = _TYPE.validate_python(transaction.type)
    entries = transaction.entries
    amount = sum(entry.amount_minor for entry in entries)
    category: CategoryRef | None = None
    account: AccountRef | None = None
    from_account: AccountRef | None = None
    to_account: AccountRef | None = None
    match kind:
        case "expense" | "income":
            category = _category_ref(entries, categories)
            account = _account_ref(entries[0], accounts)
        case "transfer":
            outgoing = next(entry for entry in entries if entry.amount_minor < 0)
            incoming = next(entry for entry in entries if entry.amount_minor > 0)
            from_account = _account_ref(outgoing, accounts)
            to_account = _account_ref(incoming, accounts)
            amount = incoming.amount_minor
        case "adjustment":
            account = _account_ref(entries[0], accounts)
        case _:
            assert_never(kind)
    return MovementRead(
        id=transaction.id,
        type=kind,
        status=_STATUS.validate_python(transaction.status),
        date=transaction.date,
        description=transaction.description,
        amount_minor=amount,
        category=category,
        account=account,
        from_account=from_account,
        to_account=to_account,
    )


def as_list_item(movement: MovementRead, balance_after_minor: int | None) -> MovementListItem:
    """The same movement as an item of the list, with the balance of the filtered account.

    The nested accounts and category are passed as they are (Pydantic does not validate a model
    instance again), so nothing is dumped to dicts and validated twice. Every field of
    `MovementRead` is named here on purpose: if one is added, mypy fails until it is copied.
    """
    return MovementListItem(
        id=movement.id,
        type=movement.type,
        status=movement.status,
        date=movement.date,
        description=movement.description,
        amount_minor=movement.amount_minor,
        category=movement.category,
        account=movement.account,
        from_account=movement.from_account,
        to_account=movement.to_account,
        balance_after_minor=balance_after_minor,
    )


def _account_ref(entry: Entry, accounts: Mapping[uuid.UUID, AccountRead]) -> AccountRef:
    account = accounts[entry.account_id]
    return AccountRef(id=account.id, name=account.name, type=account.type)


def _category_ref(
    entries: list[Entry], categories: Mapping[uuid.UUID, CategoryRead]
) -> CategoryRef | None:
    category_id = next((e.category_id for e in entries if e.category_id is not None), None)
    if category_id is None:
        return None
    category = categories[category_id]
    parent: CategoryParentRef | None = None
    if category.parent_id is not None:
        main = categories[category.parent_id]
        parent = CategoryParentRef(id=main.id, name=main.name, icon=main.icon)
    return CategoryRef(id=category.id, name=category.name, icon=category.icon, parent=parent)

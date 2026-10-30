import { EFECTIVO, ITAU, VISA } from "@/components/movements/movement-fixtures";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import type { CategoryRead } from "@/lib/core/data/categories";
import type { MovementListItem } from "@/lib/core/data/transactions";

// The accounts and the categories that the filters of Movimientos list (FE-33), for the catalog.
// They come out of the movements the demo shows, so a filter always has something to find, plus the
// cases that only a list has: archived ones, names at the limit, a list that is empty.

/** Exactly 80 characters: the longest name of an account or a category (the backend's `maxLength`). */
const NAME_80 = "Nombre de ochenta caracteres que llena todo el espacio que le dejen disponible"
  .padEnd(80, ".")
  .slice(0, 80);

const uuids = new Map<string, string>();

/**
 * A UUID for a short id of the fixtures ("a1", "c-super"). The URL only takes a UUID for the account
 * and the category (`parseMovementFilters`), and the fixtures were written before that mattered. The same
 * id always gives the same UUID, and two ids never give the same one.
 */
export function uuidOf(id: string): string {
  let uuid = uuids.get(id);
  if (uuid === undefined) {
    uuid = `00000000-0000-4000-8000-${(uuids.size + 1).toString(16).padStart(12, "0")}`;
    uuids.set(id, uuid);
  }
  return uuid;
}

const mapAccount = <T extends { id: string }>(ref: T | null): T | null =>
  ref ? { ...ref, id: uuidOf(ref.id) } : null;

/** The movements with the ids of their accounts and categories turned into UUIDs. */
export function withUuids(items: readonly MovementListItem[]): MovementListItem[] {
  return items.map((item) => ({
    ...item,
    account: mapAccount(item.account),
    from_account: mapAccount(item.from_account),
    to_account: mapAccount(item.to_account),
    category: item.category
      ? {
          ...item.category,
          id: uuidOf(item.category.id),
          parent: mapAccount(item.category.parent),
        }
      : null,
  }));
}

const accountOf = (
  uuid: string,
  name: string,
  type: AccountWithBalance["type"],
  archived = false,
): AccountWithBalance => ({
  id: uuid,
  name,
  type,
  balance_minor: 0,
  archived_at: archived ? "2026-09-01T12:00:00Z" : null,
  closing_day: null,
  due_day: null,
});
const account = (id: string, ...rest: [string, AccountWithBalance["type"], boolean?]) =>
  accountOf(uuidOf(id), ...rest);

/** Itaú, Visa Itaú and Efectivo: the accounts of the canvas, always there. */
const CANVAS_ACCOUNTS = [ITAU, VISA, EFECTIVO].map((ref) => account(ref.id, ref.name, ref.type));

/** The accounts that the movements name, once each, in the order they first show up. */
export function accountsFrom(items: readonly MovementListItem[]): AccountWithBalance[] {
  const found = new Map<string, AccountWithBalance>();
  for (const item of items) {
    for (const ref of [item.account, item.from_account, item.to_account]) {
      if (ref && !found.has(ref.id)) {
        found.set(ref.id, accountOf(ref.id, ref.name, ref.type));
      }
    }
  }
  return [...found.values()];
}

/** The categories that the movements name, with the main category of each subcategory, once each. */
export function categoriesFrom(items: readonly MovementListItem[]): CategoryRead[] {
  const found = new Map<string, CategoryRead>();
  const add = (
    ref: { id: string; name: string; icon: CategoryRead["icon"] },
    kind: CategoryRead["kind"],
    parentId: string | null,
  ) => {
    if (!found.has(ref.id)) {
      found.set(ref.id, {
        id: ref.id,
        name: ref.name,
        icon: ref.icon,
        kind,
        parent_id: parentId,
        archived_at: null,
      });
    }
  };
  for (const item of items) {
    const category = item.category;
    if (!category) continue;
    const kind = item.type === "income" ? "income" : "expense";
    if (category.parent) add(category.parent, kind, null);
    add(category, kind, category.parent?.id ?? null);
  }
  return [...found.values()];
}

const byId = <T extends { id: string }>(lists: readonly (readonly T[])[]) => {
  const seen = new Set<string>();
  return lists.flat().filter((entry) => (seen.has(entry.id) ? false : (seen.add(entry.id), true)));
};

export type Accounts = "active" | "extras" | "archived" | "none";
export const ACCOUNT_CHOICES: Record<Accounts, string> = {
  active: "Con cuentas activas (las del lienzo y las de los movimientos)",
  extras: "Con archivadas y nombres de 80 caracteres, emoji y árabe",
  archived: "Sin cuentas activas (solo una archivada)",
  none: "Ninguna cuenta",
};

/** What `GET /accounts?include_archived=true` answers for a choice, given the movements on show. */
export function accountsFor(
  choice: Accounts,
  items: readonly MovementListItem[],
): AccountWithBalance[] {
  const active = byId([CANVAS_ACCOUNTS, accountsFrom(items)]);
  switch (choice) {
    case "active":
      return active;
    case "extras":
      return [
        ...active,
        account("x-80", NAME_80, "bank", true),
        account("x-emoji", "Cuenta cerrada 🏦 حساب قديم", "cash", true),
        account("x-no-spaces", "A".repeat(80), "credit_card"),
      ];
    case "archived":
      return [account(ITAU.id, ITAU.name, ITAU.type, true)];
    case "none":
      return [];
  }
}

export type Categories = "data" | "worst" | "archived" | "none";
export const CATEGORY_CHOICES: Record<Categories, string> = {
  data: "Las de los movimientos, más una archivada",
  worst: "Peor caso: 30 principales, nombres de 80 caracteres y un «Regalos» de cada tipo",
  archived: "Todas archivadas",
  none: "Ninguna categoría",
};

const category = (
  id: string,
  name: string,
  kind: CategoryRead["kind"],
  options: { parentId?: string; archived?: boolean } = {},
): CategoryRead => ({
  id: uuidOf(id),
  name,
  icon: "tag",
  kind,
  parent_id: options.parentId ? uuidOf(options.parentId) : null,
  archived_at: options.archived ? "2026-09-01T12:00:00Z" : null,
});

/** What `GET /categories?include_archived=true` answers for a choice, given the movements on show. */
export function categoriesFor(
  choice: Categories,
  items: readonly MovementListItem[],
): CategoryRead[] {
  const used = categoriesFrom(items);
  switch (choice) {
    case "data":
      return [...used, category("x-mascotas", "Mascotas", "expense", { archived: true })];
    case "worst":
      return [
        ...used,
        ...Array.from({ length: 30 }, (_, index) =>
          category(
            `x-many-${index}`,
            `Categoría ${String(index + 1).padStart(2, "0")}`,
            index % 5 === 4 ? "income" : "expense",
          ),
        ),
        category("x-80", NAME_80, "expense", { archived: true }),
        category("x-80-sub", NAME_80.toUpperCase().slice(0, 80), "expense", {
          parentId: "x-80",
          archived: true,
        }),
        category("x-gifts-expense", "Regalos", "expense"),
        category("x-gifts-income", "Regalos", "income"),
      ];
    case "archived":
      return used.map((entry) => ({ ...entry, archived_at: "2026-09-01T12:00:00Z" }));
    case "none":
      return [];
  }
}

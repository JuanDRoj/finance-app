import { describe, expect, it } from "vitest";
import { incomeItem, movementItem, transferItem } from "@/components/movements/movement-fixtures";
import {
  accountsFor,
  accountsFrom,
  categoriesFor,
  categoriesFrom,
  uuidOf,
  withUuids,
} from "./movement-filter-lists";
import { historyMovements } from "./movements-screen-demos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("uuidOf", () => {
  it("gives a UUID, the same one for the same id and a different one for another", () => {
    expect(uuidOf("a1")).toMatch(UUID);
    expect(uuidOf("a1")).toBe(uuidOf("a1"));
    expect(uuidOf("a2")).not.toBe(uuidOf("a1"));
  });
});

describe("withUuids", () => {
  const items = withUuids([movementItem(), incomeItem(), transferItem()]);

  it("turns every account and category id into a UUID, parents included", () => {
    const ids = items.flatMap((item) => [
      item.account?.id,
      item.from_account?.id,
      item.to_account?.id,
      item.category?.id,
      item.category?.parent?.id,
    ]);
    expect(ids.filter((id) => id !== undefined)).not.toHaveLength(0);
    for (const id of ids) if (id !== undefined) expect(id).toMatch(UUID);
  });

  it("keeps the rest of the movement and the link between a subcategory and its parent", () => {
    const [expense] = items;
    expect(expense!.description).toBe("Tienda Inglesa");
    expect(expense!.category!.parent!.id).toBe(uuidOf("c1"));
  });
});

describe("the lists of accounts and categories", () => {
  const items = withUuids(historyMovements());

  it("derives each account once, and the three of the canvas are always there", () => {
    const derived = accountsFrom(items);
    expect(new Set(derived.map((a) => a.id)).size).toBe(derived.length);
    const active = accountsFor("active", items);
    expect(new Set(active.map((a) => a.id)).size).toBe(active.length);
    for (const name of ["Itaú", "Visa Itaú", "Efectivo"]) {
      expect(active.some((a) => a.name === name)).toBe(true);
    }
    expect(active.every((a) => a.archived_at === null)).toBe(true);
    // They are the ones that the movements point to.
    for (const ref of derived) expect(active.some((a) => a.id === ref.id)).toBe(true);
  });

  it("has the four choices of accounts: with archived and long ones, only an archived one, none", () => {
    const extras = accountsFor("extras", items);
    expect(extras.some((a) => a.archived_at !== null && a.name.length === 80)).toBe(true);
    expect(extras.some((a) => a.name.includes("🏦"))).toBe(true);
    const archived = accountsFor("archived", items);
    expect(archived).toHaveLength(1);
    expect(archived[0]!.archived_at).not.toBeNull();
    expect(accountsFor("none", items)).toEqual([]);
  });

  it("derives the categories with their main category, once each, with the kind of the movement", () => {
    const derived = categoriesFrom(items);
    expect(new Set(derived.map((c) => c.id)).size).toBe(derived.length);
    const sub = derived.find((c) => c.name === "Supermercado")!;
    const parent = derived.find((c) => c.id === sub.parent_id)!;
    expect(parent.name).toBe("Comida");
    expect(parent.parent_id).toBeNull();
    expect(derived.find((c) => c.name === "Sueldo")!.kind).toBe("income");
    expect(sub.kind).toBe("expense");
  });

  it("has the four choices of categories: with an archived one, the worst case, all archived, none", () => {
    expect(categoriesFor("data", items).some((c) => c.archived_at !== null)).toBe(true);
    const worst = categoriesFor("worst", items);
    expect(worst.filter((c) => c.name.startsWith("Categoría ")).length).toBe(30);
    expect(
      worst
        .filter((c) => c.name === "Regalos")
        .map((c) => c.kind)
        .sort(),
    ).toEqual(["expense", "income"]);
    expect(worst.some((c) => c.name.length === 80)).toBe(true);
    expect(new Set(worst.map((c) => c.id)).size).toBe(worst.length);
    expect(categoriesFor("archived", items).every((c) => c.archived_at !== null)).toBe(true);
    expect(categoriesFor("none", items)).toEqual([]);
  });
});

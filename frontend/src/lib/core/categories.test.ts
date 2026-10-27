import { describe, expect, it } from "vitest";
import {
  OTHER_CATEGORIES_LABEL,
  buildCategoryTree,
  categoryNameOf,
  describeCategoryChoice,
  findCategoryPlace,
  groupCategoriesForSelect,
} from "./categories";
import type { CategoryRead } from "./data/categories";

let counter = 0;
function category(
  name: string,
  overrides: Partial<CategoryRead> & { kind?: CategoryRead["kind"] } = {},
): CategoryRead {
  counter += 1;
  return {
    id: `cat-${counter}-${name}`,
    kind: "expense",
    name,
    icon: "tag",
    parent_id: null,
    archived_at: null,
    ...overrides,
  };
}

/** The API sends the principals and their subcategories mixed, in creation order. */
function sample() {
  const comida = category("Comida");
  const transporte = category("Transporte");
  const ropa = category("Ropa");
  const sueldo = category("Trabajo", { kind: "income" });
  const supermercado = category("Supermercado", { parent_id: comida.id });
  const taxi = category("Taxi y apps", { parent_id: transporte.id });
  const combustible = category("Combustible", { parent_id: transporte.id });
  const sueldoSub = category("Sueldo", { kind: "income", parent_id: sueldo.id });
  const all = [comida, transporte, ropa, sueldo, supermercado, taxi, combustible, sueldoSub];
  return { all, comida, transporte, ropa, sueldo, supermercado, taxi, combustible, sueldoSub };
}

describe("buildCategoryTree", () => {
  it("keeps the principals of the kind, each with its subcategories, in the order of the API", () => {
    const { all, comida, transporte, ropa, supermercado, taxi, combustible } = sample();
    const tree = buildCategoryTree(all, "expense");
    expect(tree.map((branch) => branch.principal)).toEqual([comida, transporte, ropa]);
    expect(tree.map((branch) => branch.subs)).toEqual([[supermercado], [taxi, combustible], []]);
  });

  it("builds the tree of the income kind apart", () => {
    const { all, sueldo, sueldoSub } = sample();
    const tree = buildCategoryTree(all, "income");
    expect(tree).toEqual([{ principal: sueldo, subs: [sueldoSub] }]);
  });

  it("leaves out the archived categories, principal or sub", () => {
    const { all, comida, transporte, taxi } = sample();
    const archivedAt = "2026-10-01T10:00:00Z";
    const archivedRopa = all.map((item) =>
      item.name === "Ropa" || item.name === "Combustible"
        ? { ...item, archived_at: archivedAt }
        : item,
    );
    const tree = buildCategoryTree(archivedRopa, "expense");
    expect(tree.map((branch) => branch.principal)).toEqual([comida, transporte]);
    expect(tree[1]?.subs).toEqual([taxi]);
  });

  it("drops a subcategory whose principal is archived: it cannot be chosen", () => {
    const { all, comida } = sample();
    const archived = all.map((item) =>
      item.id === comida.id ? { ...item, archived_at: "2026-10-01T10:00:00Z" } : item,
    );
    const tree = buildCategoryTree(archived, "expense");
    expect(tree.map((branch) => branch.principal.name)).toEqual(["Transporte", "Ropa"]);
    expect(tree.flatMap((branch) => branch.subs).map((sub) => sub.name)).not.toContain(
      "Supermercado",
    );
  });

  it("returns an empty tree for no categories, or none of that kind", () => {
    expect(buildCategoryTree([], "expense")).toEqual([]);
    const onlyIncome = [category("Trabajo", { kind: "income" })];
    expect(buildCategoryTree(onlyIncome, "expense")).toEqual([]);
  });

  it("does not change the list it is given", () => {
    const { all } = sample();
    const copy = structuredClone(all);
    buildCategoryTree(all, "expense");
    expect(all).toEqual(copy);
  });
});

describe("findCategoryPlace and categoryNameOf", () => {
  it("finds a principal, a subcategory and nothing", () => {
    const { all, transporte, taxi } = sample();
    const tree = buildCategoryTree(all, "expense");
    expect(findCategoryPlace(tree, transporte.id)).toEqual({ principal: transporte, sub: null });
    expect(findCategoryPlace(tree, taxi.id)).toEqual({ principal: transporte, sub: taxi });
    expect(findCategoryPlace(tree, "unknown")).toBeNull();
  });

  it("does not find a category of the other kind", () => {
    const { all, sueldo } = sample();
    expect(findCategoryPlace(buildCategoryTree(all, "expense"), sueldo.id)).toBeNull();
  });

  it("names the category itself: the subcategory's, not its principal's", () => {
    const { all, transporte, taxi } = sample();
    const tree = buildCategoryTree(all, "expense");
    expect(categoryNameOf(tree, taxi.id)).toBe("Taxi y apps");
    expect(categoryNameOf(tree, transporte.id)).toBe("Transporte");
    expect(categoryNameOf(tree, "unknown")).toBeNull();
  });
});

describe("describeCategoryChoice", () => {
  it('says "Principal › Sub" for a subcategory', () => {
    const { all, taxi } = sample();
    expect(describeCategoryChoice(buildCategoryTree(all, "expense"), taxi.id)).toBe(
      "Transporte › Taxi y apps",
    );
  });

  it('says "Solo X" for a principal that has subcategories', () => {
    const { all, transporte } = sample();
    expect(describeCategoryChoice(buildCategoryTree(all, "expense"), transporte.id)).toBe(
      "Solo Transporte",
    );
  });

  it("is just the name for a principal with no subcategories: it has nothing to refine", () => {
    const { all, ropa } = sample();
    expect(describeCategoryChoice(buildCategoryTree(all, "expense"), ropa.id)).toBe("Ropa");
  });

  it("is null for a category the tree does not have", () => {
    const { all } = sample();
    expect(describeCategoryChoice(buildCategoryTree(all, "expense"), "unknown")).toBeNull();
  });

  it("keeps a long name whole: cutting it is the screen's job", () => {
    const long = "Regalos y detalles para la familia y los amigos de siempre";
    const parent = category(long);
    const sub = category("Cumpleaños", { parent_id: parent.id });
    const tree = buildCategoryTree([parent, sub], "expense");
    expect(describeCategoryChoice(tree, sub.id)).toBe(`${long} › Cumpleaños`);
  });
});

describe("groupCategoriesForSelect", () => {
  it('makes a group per principal with subcategories (itself first) and gathers the rest in "Otras"', () => {
    const { all, comida, transporte, ropa, supermercado, taxi, combustible } = sample();
    const groups = groupCategoriesForSelect(buildCategoryTree(all, "expense"));
    expect(groups).toEqual([
      { label: "Comida", categories: [comida, supermercado] },
      { label: "Transporte", categories: [transporte, taxi, combustible] },
      { label: OTHER_CATEGORIES_LABEL, categories: [ropa] },
    ]);
  });

  it('puts "Otras" last whatever the order of the principals', () => {
    const ropa = category("Ropa");
    const comida = category("Comida");
    const supermercado = category("Supermercado", { parent_id: comida.id });
    const groups = groupCategoriesForSelect(
      buildCategoryTree([ropa, comida, supermercado], "expense"),
    );
    expect(groups.map((group) => group.label)).toEqual(["Comida", "Otras"]);
  });

  it('has no "Otras" group when every principal has subcategories', () => {
    const comida = category("Comida");
    const supermercado = category("Supermercado", { parent_id: comida.id });
    const groups = groupCategoriesForSelect(buildCategoryTree([comida, supermercado], "expense"));
    expect(groups.map((group) => group.label)).toEqual(["Comida"]);
  });

  it("returns no groups for an empty tree", () => {
    expect(groupCategoriesForSelect([])).toEqual([]);
  });

  it("offers every active category exactly once", () => {
    const { all } = sample();
    const tree = buildCategoryTree(all, "expense");
    const offered = groupCategoriesForSelect(tree).flatMap((group) =>
      group.categories.map((item) => item.id),
    );
    const expected = all.filter((item) => item.kind === "expense").map((item) => item.id);
    expect([...offered].sort()).toEqual([...expected].sort());
    expect(new Set(offered).size).toBe(offered.length);
  });
});

import { describe, expect, it } from "vitest";
import {
  OTHER_CATEGORIES_LABEL,
  activeSubcategoriesOf,
  buildArchivedList,
  buildCategoryTree,
  categoryNameOf,
  countUnarchivable,
  describeArchiveHelp,
  describeArchivedCategory,
  describeCategoryChoice,
  describeCategoryCounts,
  describeCategoryPlace,
  describeSubcategoryCount,
  findCategory,
  findCategoryPlace,
  findNameClash,
  groupCategoriesForSelect,
  normalizeCategoryName,
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

// ---------------------------------------------------------------------------------------------
// Managing the categories
// ---------------------------------------------------------------------------------------------

const ZONE = "America/Montevideo";
const NOW = new Date("2026-10-28T15:00:00Z");
const OCT_18 = "2026-10-18T15:00:00Z";
const OCT_2 = "2026-10-02T15:00:00Z";

describe("describeCategoryCounts", () => {
  it("counts the principals and the subcategories of the tree, with the singular", () => {
    const { all } = sample();
    expect(describeCategoryCounts(buildCategoryTree(all, "expense"))).toBe(
      "3 principales · 3 subcategorías",
    );
    expect(describeCategoryCounts(buildCategoryTree(all, "income"))).toBe(
      "1 principal · 1 subcategoría",
    );
  });

  it("says 0 subcategorías for principals with none, and 'Sin categorías' for an empty tree", () => {
    const solo = [category("Ropa"), category("Regalos")];
    expect(describeCategoryCounts(buildCategoryTree(solo, "expense"))).toBe(
      "2 principales · 0 subcategorías",
    );
    expect(describeCategoryCounts([])).toBe("Sin categorías");
  });
});

describe("describeSubcategoryCount", () => {
  it("is 'Sin subcategorías', '1 subcategoría' or 'N subcategorías'", () => {
    expect(describeSubcategoryCount(0)).toBe("Sin subcategorías");
    expect(describeSubcategoryCount(1)).toBe("1 subcategoría");
    expect(describeSubcategoryCount(3)).toBe("3 subcategorías");
  });
});

describe("findCategory and activeSubcategoriesOf", () => {
  it("finds a category by id and the active subcategories of a principal", () => {
    const { all, transporte, taxi, combustible } = sample();
    expect(findCategory(all, taxi.id)).toBe(taxi);
    expect(findCategory(all, "nope")).toBeUndefined();
    expect(activeSubcategoriesOf(all, transporte.id)).toEqual([taxi, combustible]);
    const withArchived = all.map((item) =>
      item.id === taxi.id ? { ...item, archived_at: OCT_2 } : item,
    );
    expect(activeSubcategoriesOf(withArchived, transporte.id)).toEqual([combustible]);
  });
});

describe("describeArchiveHelp", () => {
  it("counts the real active subcategories of a principal", () => {
    const { all, comida, transporte } = sample();
    expect(describeArchiveHelp(transporte, all)).toBe(
      "También se archivan sus 2 subcategorías. Los movimientos que ya la usan la conservan.",
    );
    expect(describeArchiveHelp(comida, all)).toBe(
      "También se archiva su subcategoría. Los movimientos que ya la usan la conservan.",
    );
  });

  it("does not count the archived ones, and says nothing of them when there are none", () => {
    const { all, comida, supermercado } = sample();
    const archived = all.map((item) =>
      item.id === supermercado.id ? { ...item, archived_at: OCT_2 } : item,
    );
    expect(describeArchiveHelp(comida, archived)).toBe(
      "Los movimientos que ya la usan la conservan.",
    );
  });

  it("is only the kept-movements line for a principal with no subcategories or a subcategory", () => {
    const { all, ropa, taxi } = sample();
    expect(describeArchiveHelp(ropa, all)).toBe("Los movimientos que ya la usan la conservan.");
    expect(describeArchiveHelp(taxi, all)).toBe("Los movimientos que ya la usan la conservan.");
  });
});

describe("describeCategoryPlace", () => {
  it("names the kind of a principal and the principal of a subcategory", () => {
    const { all, comida, sueldo, taxi, transporte } = sample();
    expect(describeCategoryPlace(comida, all)).toBe("Categoría de gasto · principal");
    expect(describeCategoryPlace(sueldo, all)).toBe("Categoría de ingreso · principal");
    expect(describeCategoryPlace(taxi, all)).toBe(`Subcategoría de ${transporte.name}`);
  });

  it("does not break when the principal is not in the list", () => {
    const orphan = category("Suelta", { parent_id: "gone" });
    expect(describeCategoryPlace(orphan, [orphan])).toBe("Subcategoría");
  });
});

/**
 * Mascotas (principal archived on Oct 18) with Veterinaria (archived with it), Viajes (a
 * subcategory of Ocio, archived on its own on Oct 2, Ocio is active) and Paseos (a subcategory of
 * Mascotas that had been archived before, on Oct 2, on its own).
 */
function archivedSample() {
  const ocio = category("Ocio");
  const comida = category("Comida");
  const mascotas = category("Mascotas", { archived_at: OCT_18 });
  const veterinaria = category("Veterinaria", { parent_id: mascotas.id, archived_at: OCT_18 });
  const paseos = category("Paseos", { parent_id: mascotas.id, archived_at: OCT_2 });
  const viajes = category("Viajes", { parent_id: ocio.id, archived_at: OCT_2 });
  const ingreso = category("Ventas", { kind: "income", archived_at: OCT_2 });
  const all = [ocio, comida, mascotas, veterinaria, paseos, viajes, ingreso];
  return { all, ocio, comida, mascotas, veterinaria, paseos, viajes, ingreso };
}

describe("buildArchivedList", () => {
  it("lists an archived principal with its archived subcategories nested after it, without a button", () => {
    const { all, mascotas, veterinaria, paseos, viajes, ingreso } = archivedSample();
    const items = buildArchivedList(all);
    expect(items.map((item) => item.category)).toEqual([
      mascotas,
      veterinaria,
      paseos,
      viajes,
      ingreso,
    ]);
    expect(items.map((item) => [item.nested, item.canUnarchive])).toEqual([
      [false, true],
      [true, false],
      [true, false],
      [false, true],
      [false, true],
    ]);
  });

  it("tells a subcategory archived with its principal (same moment) from one archived before", () => {
    const { all } = archivedSample();
    const [, veterinaria, paseos] = buildArchivedList(all);
    expect(veterinaria?.archivedWithParent).toBe(true);
    expect(paseos?.archivedWithParent).toBe(false);
  });

  it("compares the moments, not the text: the same instant written with another offset is the same", () => {
    const mascotas = category("Mascotas", { archived_at: "2026-10-18T15:00:00Z" });
    const veterinaria = category("Veterinaria", {
      parent_id: mascotas.id,
      archived_at: "2026-10-18T15:00:00.000+00:00",
    });
    const [, nested] = buildArchivedList([mascotas, veterinaria]);
    expect(nested?.archivedWithParent).toBe(true);
  });

  it("gives a subcategory archived on its own, under an active principal, a button and its principal", () => {
    const { all, viajes, ocio } = archivedSample();
    const item = buildArchivedList(all).find((candidate) => candidate.category === viajes);
    expect(item).toMatchObject({ parent: ocio, nested: false, canUnarchive: true });
  });

  it("keeps one kind when asked (the phone), and every kind otherwise (desktop)", () => {
    const { all, mascotas, ingreso } = archivedSample();
    expect(buildArchivedList(all, { kind: "income" }).map((item) => item.category)).toEqual([
      ingreso,
    ]);
    expect(buildArchivedList(all, { kind: "expense" })[0]?.category).toBe(mascotas);
    expect(buildArchivedList(all, { kind: "expense" })).toHaveLength(4);
  });

  it("is empty with nothing archived, and ignores the active ones", () => {
    expect(buildArchivedList(sample().all)).toEqual([]);
    expect(buildArchivedList([])).toEqual([]);
  });

  it("does not list a subcategory twice, nor lose one whose principal is not in the list", () => {
    const lone = category("Suelta", { parent_id: "not-in-the-list", archived_at: OCT_2 });
    const items = buildArchivedList([lone]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ parent: null, nested: false, canUnarchive: true });
  });
});

describe("countUnarchivable", () => {
  it("counts only the rows with a 'Desarchivar' button (the 'n' of 'Archivadas (n)')", () => {
    const { all } = archivedSample();
    const items = buildArchivedList(all);
    expect(items).toHaveLength(5);
    expect(countUnarchivable(items)).toBe(3);
    expect(countUnarchivable([])).toBe(0);
  });
});

describe("describeArchivedCategory", () => {
  const options = { timeZone: ZONE, now: NOW };

  it("writes a principal and a subcategory with their date, as the phone canvas does", () => {
    const { all } = archivedSample();
    const items = buildArchivedList(all);
    expect(describeArchivedCategory(items[0]!, options)).toBe(
      "Principal · archivada el 18 de octubre",
    );
    expect(describeArchivedCategory(items[3]!, options)).toBe(
      "En Ocio · archivada el 2 de octubre",
    );
  });

  it("puts the kind first for the desktop list, which mixes both kinds", () => {
    const { all } = archivedSample();
    const items = buildArchivedList(all);
    const desktop = { ...options, showKind: true };
    expect(describeArchivedCategory(items[0]!, desktop)).toBe(
      "Gasto · principal · archivada el 18 de octubre",
    );
    expect(describeArchivedCategory(items[3]!, desktop)).toBe(
      "Gasto · en Ocio · archivada el 2 de octubre",
    );
    expect(describeArchivedCategory(items[4]!, desktop)).toBe(
      "Ingreso · principal · archivada el 2 de octubre",
    );
  });

  it("tells a nested subcategory why it has no button", () => {
    const { all } = archivedSample();
    const items = buildArchivedList(all);
    expect(describeArchivedCategory(items[1]!, options)).toBe("Se desarchiva junto con Mascotas");
    expect(describeArchivedCategory(items[2]!, options)).toBe("Desarchiva primero Mascotas");
    // The kind and the date do not matter there.
    expect(describeArchivedCategory(items[1]!, { ...options, showKind: true })).toBe(
      "Se desarchiva junto con Mascotas",
    );
  });

  it("adds the year to a date of another year, in the space's zone", () => {
    const old = category("Viejas", { archived_at: "2025-12-31T23:00:00Z" });
    expect(describeArchivedCategory(buildArchivedList([old])[0]!, options)).toBe(
      "Principal · archivada el 31 de diciembre de 2025",
    );
  });
});

describe("findNameClash", () => {
  it("finds the principal of the same kind with the same name, ignoring case and the ends' spaces", () => {
    const { all, comida } = sample();
    expect(findNameClash(all, { name: "  comida ", kind: "expense", parentId: null })).toBe(comida);
    expect(findNameClash(all, { name: "COMIDA", kind: "expense", parentId: null })).toBe(comida);
  });

  it("does not clash with a principal of the other kind, nor with a subcategory", () => {
    const { all } = sample();
    expect(findNameClash(all, { name: "Comida", kind: "income", parentId: null })).toBeNull();
    expect(
      findNameClash(all, { name: "Supermercado", kind: "expense", parentId: null }),
    ).toBeNull();
  });

  it("looks among the subcategories of the same principal only", () => {
    const { all, comida, transporte, supermercado } = sample();
    expect(findNameClash(all, { name: "supermercado", kind: "expense", parentId: comida.id })).toBe(
      supermercado,
    );
    expect(
      findNameClash(all, { name: "Supermercado", kind: "expense", parentId: transporte.id }),
    ).toBeNull();
  });

  it("finds an archived sibling, which is the one the form offers to unarchive", () => {
    const { all, mascotas } = archivedSample();
    expect(findNameClash(all, { name: "mascotas", kind: "expense", parentId: null })).toBe(
      mascotas,
    );
  });

  it("leaves out the category being renamed", () => {
    const { all, comida } = sample();
    expect(
      findNameClash(all, { name: "Comida", kind: "expense", parentId: null, excludeId: comida.id }),
    ).toBeNull();
  });

  it("is null for a blank name", () => {
    const { all } = sample();
    expect(findNameClash(all, { name: "   ", kind: "expense", parentId: null })).toBeNull();
  });

  it("normalizes a name like the index: trimmed and lower case", () => {
    expect(normalizeCategoryName("  Cafés Y ÓMNIBUS ")).toBe("cafés y ómnibus");
  });
});

import { describeCategoryKind } from "./i18n";
import { formatInstantDayMonth } from "./dates";
import type { CategoryKind, CategoryRead } from "./data/categories";

/**
 * Pure helpers over the flat list `GET /spaces/{id}/categories` returns, for the screens that pick
 * a category (docs/diseno.md D19): the grid of principals with a second step for their
 * subcategories on a phone, and the `select` grouped by principal on desktop; and for the ones that
 * manage them (Categorías and its forms): the archived ones with their rules, the sibling a name
 * clashes with, and the counts and the help in Spanish. No DOM, no React.
 */

/** A principal category with its subcategories, as the screens pick them. */
export type CategoryBranch = {
  principal: CategoryRead;
  /** Its active subcategories, in the order the API sent them. Empty for a principal with none. */
  subs: CategoryRead[];
};

/**
 * The active categories of one kind as a two-level tree, in the order of the API (creation order):
 * the principals, each with its subcategories. The archived ones are left out, and so is a
 * subcategory whose principal is not in the list (an archived principal takes its subcategories
 * with it, so one without its principal cannot be chosen: the backend would answer
 * `category_archived`). The kind of a subcategory is its principal's, so only the principals are
 * filtered by `kind`.
 */
export function buildCategoryTree(
  categories: readonly CategoryRead[],
  kind: CategoryKind,
): CategoryBranch[] {
  const branches = new Map<string, CategoryBranch>();
  for (const category of categories) {
    if (category.archived_at !== null || category.parent_id !== null || category.kind !== kind) {
      continue;
    }
    branches.set(category.id, { principal: category, subs: [] });
  }
  for (const category of categories) {
    if (category.archived_at !== null || category.parent_id === null) continue;
    branches.get(category.parent_id)?.subs.push(category);
  }
  return [...branches.values()];
}

/** Where a category sits in the tree: its principal, and itself if it is a subcategory. */
export type CategoryPlace = { principal: CategoryRead; sub: CategoryRead | null };

/** The place of the category with this id, or `null` if the tree does not have it (not active, other kind). */
export function findCategoryPlace(
  tree: readonly CategoryBranch[],
  categoryId: string,
): CategoryPlace | null {
  for (const { principal, subs } of tree) {
    if (principal.id === categoryId) return { principal, sub: null };
    const sub = subs.find((candidate) => candidate.id === categoryId);
    if (sub) return { principal, sub };
  }
  return null;
}

/** The name of the category itself (the principal's or the subcategory's): the one a toast names. */
export function categoryNameOf(tree: readonly CategoryBranch[], categoryId: string): string | null {
  const place = findCategoryPlace(tree, categoryId);
  if (!place) return null;
  return (place.sub ?? place.principal).name;
}

/**
 * The line under the grid that says what was chosen, for a principal that has subcategories
 * (docs/diseno.md D19): "Transporte › Taxi y apps" for a subcategory and "Solo Transporte" for the
 * principal itself. A principal with no subcategories has nothing to refine, so it is just its name.
 * `null` if the tree does not have the category.
 */
export function describeCategoryChoice(
  tree: readonly CategoryBranch[],
  categoryId: string,
): string | null {
  const place = findCategoryPlace(tree, categoryId);
  if (!place) return null;
  if (place.sub) return `${place.principal.name} › ${place.sub.name}`;
  const branch = tree.find((candidate) => candidate.principal.id === place.principal.id);
  return branch && branch.subs.length > 0 ? `Solo ${place.principal.name}` : place.principal.name;
}

/** The `optgroup` that gathers the principals with no subcategories (the canvas calls it "Otras"). */
export const OTHER_CATEGORIES_LABEL = "Otras";

/** An `optgroup` of the desktop `select`: its label and the categories (options) inside. */
export type CategorySelectGroup = { label: string; categories: CategoryRead[] };

/**
 * The groups of the `select` of desktop (docs/diseno.md D17 › Escritorio v2): a principal with
 * subcategories is a group named after it, with the principal itself first (a movement may go to a
 * principal that has subcategories) and then its subcategories; the principals with none are
 * gathered, in order, in a last group "Otras" (as the canvas draws it). A group that would be empty
 * is not returned.
 */
export function groupCategoriesForSelect(tree: readonly CategoryBranch[]): CategorySelectGroup[] {
  const groups: CategorySelectGroup[] = [];
  const alone: CategoryRead[] = [];
  for (const { principal, subs } of tree) {
    if (subs.length === 0) alone.push(principal);
    else groups.push({ label: principal.name, categories: [principal, ...subs] });
  }
  if (alone.length > 0) groups.push({ label: OTHER_CATEGORIES_LABEL, categories: alone });
  return groups;
}

// ---------------------------------------------------------------------------------------------
// Managing the categories (Categorías and its forms, docs/diseno.md D19)
// ---------------------------------------------------------------------------------------------

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "9 principales · 13 subcategorías" (and "1 principal · 1 subcategoría") for the tree of one kind. */
export function describeCategoryCounts(tree: readonly CategoryBranch[]): string {
  if (tree.length === 0) return "Sin categorías";
  const subs = tree.reduce((total, branch) => total + branch.subs.length, 0);
  return `${plural(tree.length, "principal", "principales")} · ${plural(subs, "subcategoría", "subcategorías")}`;
}

/** The secondary line of a principal's row: "3 subcategorías", "1 subcategoría" or "Sin subcategorías". */
export function describeSubcategoryCount(count: number): string {
  return count === 0 ? "Sin subcategorías" : plural(count, "subcategoría", "subcategorías");
}

/** The category with this id in the flat list, or `undefined`. */
export function findCategory(
  categories: readonly CategoryRead[],
  categoryId: string,
): CategoryRead | undefined {
  return categories.find((category) => category.id === categoryId);
}

/** The active subcategories of a principal, in the order of the API. */
export function activeSubcategoriesOf(
  categories: readonly CategoryRead[],
  principalId: string,
): CategoryRead[] {
  return categories.filter(
    (category) => category.parent_id === principalId && category.archived_at === null,
  );
}

/**
 * The line under the button "Archivar categoría" (docs/diseno.md D19): a principal also archives its
 * **active** subcategories, and says how many ("También se archivan sus 3 subcategorías.", "También
 * se archiva su subcategoría."); a subcategory, or a principal with none, only says that the old
 * movements keep it. The count is of the real subcategories, not a fixed number.
 */
export function describeArchiveHelp(
  category: CategoryRead,
  categories: readonly CategoryRead[],
): string {
  const kept = "Los movimientos que ya la usan la conservan.";
  if (category.parent_id !== null) return kept;
  const count = activeSubcategoriesOf(categories, category.id).length;
  if (count === 0) return kept;
  const also =
    count === 1
      ? "También se archiva su subcategoría."
      : `También se archivan sus ${count} subcategorías.`;
  return `${also} ${kept}`;
}

/** The note at the top of the edit form: "Categoría de gasto · principal" / "Subcategoría de {principal}". */
export function describeCategoryPlace(
  category: CategoryRead,
  categories: readonly CategoryRead[],
): string {
  if (category.parent_id === null) {
    return `Categoría de ${describeCategoryKind(category.kind).toLowerCase()} · principal`;
  }
  const parent = findCategory(categories, category.parent_id);
  return parent ? `Subcategoría de ${parent.name}` : "Subcategoría";
}

/** An archived category as the list "Archivadas" shows it (docs/diseno.md D19). */
export type ArchivedCategoryItem = {
  category: CategoryRead;
  /** Its principal, for a subcategory (`null` for a principal, or if the list has not got it). */
  parent: CategoryRead | null;
  /** Under an archived principal: drawn indented below it. */
  nested: boolean;
  /**
   * For a nested subcategory: whether it was archived together with its principal (the same
   * `archived_at`, which is what the backend gives them in one archive), so unarchiving the
   * principal brings it back. `false` if it had been archived on its own before.
   */
  archivedWithParent: boolean;
  /**
   * Whether it has a "Desarchivar" button. A subcategory under an archived principal has none:
   * unarchiving it alone is a 409 `category_parent_archived`.
   */
  canUnarchive: boolean;
};

function sameInstant(first: string | null, second: string | null): boolean {
  if (first === null || second === null) return false;
  return new Date(first).getTime() === new Date(second).getTime();
}

/**
 * The archived categories in the order of the "Archivadas (n)" list: walking the API's order, an
 * archived principal is followed by its archived subcategories (nested, without a button), and an
 * archived subcategory whose principal is active stands on its own (with a button). `kind` keeps
 * one kind only (the phone shows the kind chosen in its segmented control; desktop shows both).
 */
export function buildArchivedList(
  categories: readonly CategoryRead[],
  options: { kind?: CategoryKind } = {},
): ArchivedCategoryItem[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const items: ArchivedCategoryItem[] = [];
  for (const category of categories) {
    if (category.archived_at === null) continue;
    if (options.kind !== undefined && category.kind !== options.kind) continue;
    if (category.parent_id === null) {
      items.push({
        category,
        parent: null,
        nested: false,
        archivedWithParent: false,
        canUnarchive: true,
      });
      for (const sub of categories) {
        if (sub.parent_id !== category.id || sub.archived_at === null) continue;
        items.push({
          category: sub,
          parent: category,
          nested: true,
          archivedWithParent: sameInstant(sub.archived_at, category.archived_at),
          canUnarchive: false,
        });
      }
      continue;
    }
    const parent = byId.get(category.parent_id) ?? null;
    // Under an archived principal it was listed with it above.
    if (parent !== null && parent.archived_at !== null) continue;
    items.push({
      category,
      parent,
      nested: false,
      archivedWithParent: false,
      canUnarchive: true,
    });
  }
  return items;
}

/** The "n" of "Archivadas (n)": only the ones with a "Desarchivar" button count. */
export function countUnarchivable(items: readonly ArchivedCategoryItem[]): number {
  return items.filter((item) => item.canUnarchive).length;
}

/**
 * The secondary line of an archived row, as the canvas writes it (K-H1-Categorias, K-V2-Escritorio):
 * "Principal · archivada el 18 de octubre", "En Ocio · archivada el 2 de octubre", and for a
 * subcategory under an archived principal "Se desarchiva junto con Mascotas" or, if it had been
 * archived before on its own, "Desarchiva primero Mascotas" (docs/diseno.md D19). The date is the
 * day of `archived_at` in the space's zone. With `showKind` (desktop, whose list mixes both kinds)
 * the kind goes first: "Gasto · principal · archivada el 18 de octubre". A subcategory whose
 * principal is not in the list says no place ("Archivada el 2 de octubre"), never "Principal".
 */
export function describeArchivedCategory(
  item: ArchivedCategoryItem,
  options: { timeZone: string; now?: Date; showKind?: boolean },
): string {
  const { category, parent } = item;
  if (item.nested && parent) {
    return item.archivedWithParent
      ? `Se desarchiva junto con ${parent.name}`
      : `Desarchiva primero ${parent.name}`;
  }
  const parts: string[] = [];
  if (options.showKind) parts.push(describeCategoryKind(category.kind));
  // Principal or sub is `parent_id`'s to say, not the presence of `parent`: a subcategory whose
  // principal is not in the list must not read "Principal". Without the principal's name there is no
  // place to name, so that part is left out.
  if (category.parent_id === null) parts.push("principal");
  else if (parent) parts.push(`en ${parent.name}`);
  if (category.archived_at !== null) {
    parts.push(
      `archivada el ${formatInstantDayMonth(category.archived_at, options.timeZone, options.now)}`,
    );
  }
  const text = parts.join(" · ");
  return text.charAt(0).toLocaleUpperCase("es") + text.slice(1);
}

/** The name as the database compares it among siblings: without the ends' spaces, ignoring case. */
export function normalizeCategoryName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The sibling a name clashes with, or `null` (docs/diseno.md D19, "Nombre repetido"). The backend
 * only answers 409 `category_name_taken`, so the form looks for it in the list with the archived
 * ones: among the principals of the same kind (`parentId` `null`) or among the subcategories of the
 * same principal, without the spaces at the ends and ignoring case, like the unique index.
 * `excludeId` leaves out the category being renamed.
 */
export function findNameClash(
  categories: readonly CategoryRead[],
  query: { name: string; kind: CategoryKind; parentId: string | null; excludeId?: string },
): CategoryRead | null {
  const wanted = normalizeCategoryName(query.name);
  if (wanted === "") return null;
  const siblings = categories.filter((category) =>
    query.parentId === null
      ? category.parent_id === null && category.kind === query.kind
      : category.parent_id === query.parentId,
  );
  return (
    siblings.find(
      (category) =>
        category.id !== query.excludeId && normalizeCategoryName(category.name) === wanted,
    ) ?? null
  );
}

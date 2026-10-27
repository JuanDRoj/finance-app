import type { CategoryKind, CategoryRead } from "./data/categories";

/**
 * Pure helpers over the flat list `GET /spaces/{id}/categories` returns, for the screens that pick
 * a category (docs/diseno.md D19): the grid of principals with a second step for their
 * subcategories on a phone, and the `select` grouped by principal on desktop. No DOM, no React.
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

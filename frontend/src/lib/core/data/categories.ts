import { queryOptions } from "@tanstack/react-query";
import type { components } from "@/lib/api/schema";
import type { ApiClient } from "./api-client";
import { unwrap } from "./errors";
import { spaceQueryKey } from "./spaces";

/** A category, principal or sub: a subcategory points at its principal with `parent_id`. */
export type CategoryRead = components["schemas"]["CategoryRead"];

/** `expense` or `income`: the kind of a category, and of the movements that may use it. */
export type CategoryKind = CategoryRead["kind"];

/** Body of `POST /spaces/{space_id}/categories`: a principal category, or a subcategory with `parent_id`. */
export type CategoryCreate = components["schemas"]["CategoryCreate"];

/** Body of `PATCH /spaces/{space_id}/categories/{category_id}`: only the fields to change. */
export type CategoryUpdate = components["schemas"]["CategoryUpdate"];

/** The key of a category's icon: one of the fixed list the backend publishes (`CategoryIcon`). */
export type CategoryIconKey = CategoryRead["icon"];

/**
 * The root of everything about the categories of a space (`["spaces", spaceId, "categories"]`): the
 * prefix of `categoriesQueryKey` whatever its options, so one invalidation reaches the list with the
 * archived ones (Categorías) and without them (the sheet of "Registrar movimiento").
 */
export function categoriesRootKey(spaceId: string) {
  return [...spaceQueryKey(spaceId), "categories"] as const;
}

/** Key of the categories of a space, under the space's own (`["spaces", spaceId, "categories", ...]`). */
export function categoriesQueryKey(spaceId: string, options: { includeArchived?: boolean } = {}) {
  return [
    ...categoriesRootKey(spaceId),
    { includeArchived: options.includeArchived === true },
  ] as const;
}

/**
 * The categories of a space, principal and sub, flat, in the order they were created (the order the
 * screens show them in). Archived ones only on request. Throws an `ApiError`: `space_not_found`
 * (404) or a 401.
 */
export async function listCategories(
  api: ApiClient,
  spaceId: string,
  options: { includeArchived?: boolean } = {},
): Promise<CategoryRead[]> {
  return unwrap(
    api.GET("/spaces/{space_id}/categories", {
      params: {
        path: { space_id: spaceId },
        // Left out when false: the backend's default is already "active ones only".
        ...(options.includeArchived ? { query: { include_archived: true } } : {}),
      },
    }),
  );
}

/** Query options of the categories of a space (key `categoriesQueryKey`). */
export function categoriesQueryOptions(
  api: ApiClient,
  spaceId: string,
  options: { includeArchived?: boolean } = {},
) {
  return queryOptions({
    queryKey: categoriesQueryKey(spaceId, options),
    queryFn: () => listCategories(api, spaceId, options),
  });
}

/**
 * Creates a principal category, or a subcategory when `body.parent_id` is set (`POST
 * /spaces/{space_id}/categories`, 201). A subcategory has the kind of its principal, which must be an
 * active principal. Throws an `ApiError`: 409 `category_name_taken` (the name is used by a sibling,
 * archived ones included), 422 (`category_parent_not_found`, `category_parent_not_main`,
 * `category_kind_mismatch`, `category_parent_archived` and the usual field types), 404
 * `space_not_found` or a 401.
 */
export async function createCategory(
  api: ApiClient,
  spaceId: string,
  body: CategoryCreate,
): Promise<CategoryRead> {
  return unwrap(
    api.POST("/spaces/{space_id}/categories", { params: { path: { space_id: spaceId } }, body }),
  );
}

type CategoryPath = { params: { path: { space_id: string; category_id: string } } };
const categoryPath = (spaceId: string, categoryId: string): CategoryPath => ({
  params: { path: { space_id: spaceId, category_id: categoryId } },
});

/**
 * Renames a category or changes its icon (`PATCH .../{category_id}`); only the fields in `body`
 * change, and the kind and the parent never do. Throws an `ApiError`: 409 `category_name_taken`, 404
 * `category_not_found`, a 422 or a 401.
 */
export async function updateCategory(
  api: ApiClient,
  spaceId: string,
  categoryId: string,
  body: CategoryUpdate,
): Promise<CategoryRead> {
  return unwrap(
    api.PATCH("/spaces/{space_id}/categories/{category_id}", {
      ...categoryPath(spaceId, categoryId),
      body,
    }),
  );
}

/**
 * Archives a category (`POST .../archive`); a principal one takes its active subcategories with it
 * (they all get the same `archived_at`). It is no longer offered for new movements; the old ones
 * keep it. Archiving an archived category changes nothing. Throws `category_not_found` (404) or a 401.
 */
export async function archiveCategory(
  api: ApiClient,
  spaceId: string,
  categoryId: string,
): Promise<CategoryRead> {
  return unwrap(
    api.POST(
      "/spaces/{space_id}/categories/{category_id}/archive",
      categoryPath(spaceId, categoryId),
    ),
  );
}

/**
 * Makes an archived category active again (`POST .../unarchive`); a principal one also restores the
 * subcategories that were archived with it. A subcategory whose principal is archived cannot come
 * back: 409 `category_parent_archived`. Throws `category_not_found` (404) or a 401.
 */
export async function unarchiveCategory(
  api: ApiClient,
  spaceId: string,
  categoryId: string,
): Promise<CategoryRead> {
  return unwrap(
    api.POST(
      "/spaces/{space_id}/categories/{category_id}/unarchive",
      categoryPath(spaceId, categoryId),
    ),
  );
}

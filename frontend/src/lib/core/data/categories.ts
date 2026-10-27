import { queryOptions } from "@tanstack/react-query";
import type { components } from "@/lib/api/schema";
import type { ApiClient } from "./api-client";
import { unwrap } from "./errors";
import { spaceQueryKey } from "./spaces";

/** A category, principal or sub: a subcategory points at its principal with `parent_id`. */
export type CategoryRead = components["schemas"]["CategoryRead"];

/** `expense` or `income`: the kind of a category, and of the movements that may use it. */
export type CategoryKind = CategoryRead["kind"];

/** The key of a category's icon: one of the fixed list the backend publishes (`CategoryIcon`). */
export type CategoryIconKey = CategoryRead["icon"];

/** Key of the categories of a space, under the space's own (`["spaces", spaceId, "categories", ...]`). */
export function categoriesQueryKey(spaceId: string, options: { includeArchived?: boolean } = {}) {
  return [
    ...spaceQueryKey(spaceId),
    "categories",
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

import type { components } from "@/lib/api/schema";
import type { ApiClient } from "./api-client";
import { unwrap } from "./errors";
import { spaceQueryKey } from "./spaces";

/** An account with its balance in the minor unit of the space's currency (a card owes when negative). */
export type AccountWithBalance = components["schemas"]["AccountWithBalance"];

/** Body of `POST /spaces/{space_id}/accounts`. */
export type AccountCreate = components["schemas"]["AccountCreate"];

export type AccountType = AccountWithBalance["type"];

/** Key of the accounts of a space, under the space's own (`["spaces", spaceId, "accounts", ...]`). */
export function accountsQueryKey(spaceId: string, options: { includeArchived?: boolean } = {}) {
  return [
    ...spaceQueryKey(spaceId),
    "accounts",
    { includeArchived: options.includeArchived === true },
  ] as const;
}

/**
 * The accounts of a space by name, each with its balance. Archived ones only on request. Throws an
 * `ApiError`: `space_not_found` (404) or a 401.
 */
export async function listAccounts(
  api: ApiClient,
  spaceId: string,
  options: { includeArchived?: boolean } = {},
): Promise<AccountWithBalance[]> {
  return unwrap(
    api.GET("/spaces/{space_id}/accounts", {
      params: {
        path: { space_id: spaceId },
        // Left out when false: the backend's default is already "active ones only".
        ...(options.includeArchived ? { query: { include_archived: true } } : {}),
      },
    }),
  );
}

/**
 * Creates an account (`POST /spaces/{space_id}/accounts`, 201). With `initial_balance_minor` other
 * than 0 the backend also writes an adjustment in the same transaction (not income, not expense);
 * on a credit card that is the current debt, **negative**. Throws an `ApiError`: `space_not_found`
 * (404), a 422 (`card_day_required` and `card_day_not_allowed` among its types) or a 401.
 */
export async function createAccount(
  api: ApiClient,
  spaceId: string,
  body: AccountCreate,
): Promise<AccountWithBalance> {
  return unwrap(
    api.POST("/spaces/{space_id}/accounts", { params: { path: { space_id: spaceId } }, body }),
  );
}

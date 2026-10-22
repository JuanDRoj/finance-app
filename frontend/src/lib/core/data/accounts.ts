import { queryOptions } from "@tanstack/react-query";
import type { components } from "@/lib/api/schema";
import type { ApiClient } from "./api-client";
import { ApiError, unwrap } from "./errors";
import { spaceQueryKey } from "./spaces";

/** An account with its balance in the minor unit of the space's currency (a card owes when negative). */
export type AccountWithBalance = components["schemas"]["AccountWithBalance"];

/** Body of `PATCH /spaces/{space_id}/accounts/{account_id}`: only the fields to change. */
export type AccountUpdate = components["schemas"]["AccountUpdate"];

/** Body of `POST .../reconcile`: the real balance, with the sign of `balance_minor`. */
export type AccountReconcile = components["schemas"]["AccountReconcile"];

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

/**
 * Query options of the accounts of a space (key `accountsQueryKey`). The Cuentas screen asks for
 * the archived ones too (`includeArchived: true`) and tells them apart on the client, which is one
 * request less than two lists.
 */
export function accountsQueryOptions(
  api: ApiClient,
  spaceId: string,
  options: { includeArchived?: boolean } = {},
) {
  return queryOptions({
    queryKey: accountsQueryKey(spaceId, options),
    queryFn: () => listAccounts(api, spaceId, options),
  });
}

/**
 * Makes an archived account active again (`POST /spaces/{space_id}/accounts/{account_id}/unarchive`),
 * whatever its balance; on an active one nothing changes. Throws an `ApiError`: `account_not_found`
 * (404) or a 401.
 */
export async function unarchiveAccount(
  api: ApiClient,
  spaceId: string,
  accountId: string,
): Promise<AccountWithBalance> {
  return unwrap(
    api.POST("/spaces/{space_id}/accounts/{account_id}/unarchive", {
      params: { path: { space_id: spaceId, account_id: accountId } },
    }),
  );
}

type AccountPath = { params: { path: { space_id: string; account_id: string } } };
const accountPath = (spaceId: string, accountId: string): AccountPath => ({
  params: { path: { space_id: spaceId, account_id: accountId } },
});

/** One account with its balance, archived or not (`GET .../{account_id}`). Throws `account_not_found` (404) or a 401. */
export async function getAccount(
  api: ApiClient,
  spaceId: string,
  accountId: string,
): Promise<AccountWithBalance> {
  return unwrap(
    api.GET("/spaces/{space_id}/accounts/{account_id}", accountPath(spaceId, accountId)),
  );
}

/**
 * Renames an account or changes the days of a card (`PATCH .../{account_id}`); only the fields in
 * `body` change. The type cannot. Throws `account_not_found` (404), a 422 or a 401.
 */
export async function updateAccount(
  api: ApiClient,
  spaceId: string,
  accountId: string,
  body: AccountUpdate,
): Promise<AccountWithBalance> {
  return unwrap(
    api.PATCH("/spaces/{space_id}/accounts/{account_id}", {
      ...accountPath(spaceId, accountId),
      body,
    }),
  );
}

/**
 * Archives an account whose balance is zero (`POST .../archive`). Throws an `ApiError`:
 * `account_has_balance` (409: the balance is not zero), `account_not_found` (404) or a 401.
 */
export async function archiveAccount(
  api: ApiClient,
  spaceId: string,
  accountId: string,
): Promise<AccountWithBalance> {
  return unwrap(
    api.POST("/spaces/{space_id}/accounts/{account_id}/archive", accountPath(spaceId, accountId)),
  );
}

/**
 * Matches the balance of an account to the real one (`POST .../reconcile`): the backend registers an
 * adjustment for the difference, or nothing if there is none. `body.balance_minor` has the sign of
 * the balance (a card owes when negative). Throws `account_archived` (409), `account_not_found`
 * (404), a 422 or a 401.
 */
export async function reconcileAccount(
  api: ApiClient,
  spaceId: string,
  accountId: string,
  body: AccountReconcile,
): Promise<AccountWithBalance> {
  return unwrap(
    api.POST("/spaces/{space_id}/accounts/{account_id}/reconcile", {
      ...accountPath(spaceId, accountId),
      body,
    }),
  );
}

/** The code the backend put in an error body (`{ code, detail }`), if it is a string. */
export function apiErrorCode(error: unknown): string | undefined {
  const body = error instanceof ApiError ? error.body : undefined;
  const code = (body as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}

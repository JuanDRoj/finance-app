import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { components, paths } from "@/lib/api/schema";
import type { ApiClient } from "./api-client";
import { unwrap } from "./errors";
import { spaceQueryKey } from "./spaces";

/** A movement as the backend answers it: its entries are built by the backend, never sent. */
export type TransactionRead = components["schemas"]["TransactionRead"];

/**
 * What a person registers by hand: an expense, an income or a transfer, told apart by `type`. The
 * OpenAPI document publishes the body of `POST /spaces/{space_id}/transactions` as this anonymous
 * union (there is no named `MovementCreate` schema), so the alias is made here. An adjustment is
 * not part of it: it only comes from "Cuadrar saldo" and the backend refuses it with a 422
 * `union_tag_invalid`.
 */
export type MovementCreate =
  | components["schemas"]["ExpenseCreate"]
  | components["schemas"]["IncomeCreate"]
  | components["schemas"]["TransferCreate"];

/** The `type` of a movement a person can register. */
export type MovementType = MovementCreate["type"];

// Contract check, in both directions: the alias above must be exactly the body of the endpoint. If
// the backend adds a type to the union (or drops one), `npm run typecheck` fails here instead of
// the form quietly drifting from the API.
type MovementBodyOfApi = NonNullable<
  paths["/spaces/{space_id}/transactions"]["post"]["requestBody"]
>["content"]["application/json"];
const _alias: MovementBodyOfApi = {} as MovementCreate;
const _api: MovementCreate = {} as MovementBodyOfApi;
void [_alias, _api];

/**
 * `code` of the 409 of `POST /spaces/{space_id}/transactions` when the `Idempotency-Key` was already
 * used, by a movement that was saved, with another body. Codes of the backend are never renamed.
 */
export const IDEMPOTENCY_KEY_REUSED = "idempotency_key_reused";

/**
 * Root of every query key of the movements of a space: `["spaces", spaceId, "transactions", ...]`.
 * The list and the summary of Movimientos (FE-22, FE-32) hang their keys from it, so invalidating
 * this one refreshes them after a movement is registered, edited or deleted.
 */
export function transactionsQueryKey(spaceId: string) {
  return [...spaceQueryKey(spaceId), "transactions"] as const;
}

/**
 * Registers an expense, an income or a transfer (`POST /spaces/{space_id}/transactions`, 201). The
 * amount is always positive, in the minor unit of the space's currency: the backend applies the
 * sign (an expense on a credit card raises the debt). The movement is born `confirmed`.
 *
 * `idempotencyKey` is the UUID of the `Idempotency-Key` header (BE-24): one per attempt to register
 * a movement, **reused** when the same request is sent again (a lost response, a 5xx), so the
 * backend creates one movement and answers the repeat with the same one. A request that fails
 * (4xx or 5xx) does not use the key, so a corrected body may reuse it. The same key with another
 * body, after the first one worked, is a 409 `idempotency_key_reused`.
 *
 * Throws an `ApiError`: `space_not_found` (404), a 401, a 409 `idempotency_key_reused`, or a 422
 * whose `loc` is `["body", "<type>", "<field>"]` (the type is part of the location, see
 * `movementFormFieldOf`).
 */
export async function createTransaction(
  api: ApiClient,
  spaceId: string,
  body: MovementCreate,
  idempotencyKey: string,
): Promise<TransactionRead> {
  return unwrap(
    api.POST("/spaces/{space_id}/transactions", {
      params: { path: { space_id: spaceId }, header: { "Idempotency-Key": idempotencyKey } },
      body,
    }),
  );
}

// --- The list and the summary of Movimientos (FE-32, KAN-97) --------------------------------------

/** One movement of the list, as `GET /spaces/{space_id}/transactions` shows it (amounts have a sign by type). */
export type MovementListItem = components["schemas"]["MovementListItem"];

/** A page of the list: its items and the opaque cursor of the next one (`null` on the last). */
export type MovementPage = components["schemas"]["MovementPage"];

/** What the filtered period adds up to (`GET .../transactions/summary`): the `m` of "n de m" included. */
export type TransactionSummary = components["schemas"]["TransactionSummaryRead"];

/** `expense`, `income`, `transfer` or `adjustment`: the type of a listed movement and the `type` filter. */
export type TransactionType = MovementListItem["type"];

/**
 * The filters of the list and of the summary, all optional and combined by the backend: `month`
 * (`YYYY-MM`, on the local date of each movement), `type`, `accountId`, `categoryId` (a principal
 * includes its subcategories) and `q` (the description, ignoring case and accents; 1 to 100
 * characters, so an empty text must be left out, not sent). Names are the frontend's; the query
 * uses the backend's (`account_id`, `category_id`).
 */
export type TransactionFilters = {
  month?: string;
  type?: TransactionType;
  accountId?: string;
  categoryId?: string;
  q?: string;
};

/**
 * Movements per page, on every width: the server prefetches the first page without knowing the
 * width, and the query key has to be the same one the browser asks for (the backend's default).
 */
export const TRANSACTIONS_PAGE_SIZE = 50;

/** The filters in the shape the backend wants, with only the ones that are set. */
function filterQuery(filters: TransactionFilters) {
  return {
    ...(filters.month === undefined ? {} : { month: filters.month }),
    ...(filters.type === undefined ? {} : { type: filters.type }),
    ...(filters.accountId === undefined ? {} : { account_id: filters.accountId }),
    ...(filters.categoryId === undefined ? {} : { category_id: filters.categoryId }),
    ...(filters.q === undefined ? {} : { q: filters.q }),
  };
}

/** The filters as they go in a query key: only the set ones, so `{}` and `{ q: undefined }` are the same key. */
function keyFilters(filters: TransactionFilters): TransactionFilters {
  return {
    ...(filters.month === undefined ? {} : { month: filters.month }),
    ...(filters.type === undefined ? {} : { type: filters.type }),
    ...(filters.accountId === undefined ? {} : { accountId: filters.accountId }),
    ...(filters.categoryId === undefined ? {} : { categoryId: filters.categoryId }),
    ...(filters.q === undefined ? {} : { q: filters.q }),
  };
}

/** Key of the list of movements with these filters, under the root of the space's movements. */
export function transactionsListKey(spaceId: string, filters: TransactionFilters) {
  return [...transactionsQueryKey(spaceId), "list", keyFilters(filters)] as const;
}

/** Key of the summary of the movements with these filters, under the same root. */
export function transactionsSummaryKey(spaceId: string, filters: TransactionFilters) {
  return [...transactionsQueryKey(spaceId), "summary", keyFilters(filters)] as const;
}

/**
 * One page of the movements of a space, newest first (`GET /spaces/{space_id}/transactions`):
 * `date` descending, then `id` descending. `cursor` is the opaque `next_cursor` of the previous
 * page, sent back with the **same filters**; without it, the first page. Throws an `ApiError`:
 * `space_not_found` (404), a 401, or a 422 (`cursor_invalid` when the cursor cannot be read).
 */
export async function listTransactions(
  api: ApiClient,
  spaceId: string,
  filters: TransactionFilters,
  cursor?: string | null,
): Promise<MovementPage> {
  return unwrap(
    api.GET("/spaces/{space_id}/transactions", {
      params: {
        path: { space_id: spaceId },
        query: {
          ...filterQuery(filters),
          limit: TRANSACTIONS_PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        },
      },
    }),
  );
}

/**
 * What the filtered movements add up to (`GET /spaces/{space_id}/transactions/summary`): income,
 * expense and what is left, which count only confirmed incomes and expenses (never transfers nor
 * adjustments), and `count`, every movement the list would show. Same filters as the list. Throws
 * an `ApiError`: `space_not_found` (404), a 401 or a 422.
 */
export async function getTransactionsSummary(
  api: ApiClient,
  spaceId: string,
  filters: TransactionFilters,
): Promise<TransactionSummary> {
  return unwrap(
    api.GET("/spaces/{space_id}/transactions/summary", {
      params: { path: { space_id: spaceId }, query: filterQuery(filters) },
    }),
  );
}

/**
 * The list of movements as an infinite query: the pages follow the cursor of the backend
 * (`initialPageParam` is `null`: the first page has none, and `null`, unlike `undefined`, survives
 * the trip from the server to the browser when the page is prefetched).
 */
export function transactionsListQueryOptions(
  api: ApiClient,
  spaceId: string,
  filters: TransactionFilters,
) {
  return infiniteQueryOptions({
    queryKey: transactionsListKey(spaceId, filters),
    queryFn: ({ pageParam }) => listTransactions(api, spaceId, filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: MovementPage) => lastPage.next_cursor,
  });
}

/** Query options of the summary of the movements with these filters (key `transactionsSummaryKey`). */
export function transactionsSummaryQueryOptions(
  api: ApiClient,
  spaceId: string,
  filters: TransactionFilters,
) {
  return queryOptions({
    queryKey: transactionsSummaryKey(spaceId, filters),
    queryFn: () => getTransactionsSummary(api, spaceId, filters),
  });
}

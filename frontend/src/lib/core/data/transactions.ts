import {
  infiniteQueryOptions,
  queryOptions,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import type { components, paths } from "@/lib/api/schema";
import type { ApiClient } from "./api-client";
import { ApiError, unwrap } from "./errors";
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
// the form quietly drifting from the API. `PUT .../transactions/{id}` takes the same body (an edit
// replaces the whole movement), so it is checked too.
type MovementBodyOfApi = NonNullable<
  paths["/spaces/{space_id}/transactions"]["post"]["requestBody"]
>["content"]["application/json"];
const _alias: MovementBodyOfApi = {} as MovementCreate;
const _api: MovementCreate = {} as MovementBodyOfApi;
type MovementBodyOfUpdate = NonNullable<
  paths["/spaces/{space_id}/transactions/{transaction_id}"]["put"]["requestBody"]
>["content"]["application/json"];
const _updateAlias: MovementBodyOfUpdate = {} as MovementCreate;
const _updateApi: MovementCreate = {} as MovementBodyOfUpdate;
void [_alias, _api, _updateAlias, _updateApi];

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
 * page, sent back with the **same filters**; without it, the first page. `limit` (1 to 100) is how
 * many items the page has: `TRANSACTIONS_PAGE_SIZE` unless the caller wants fewer, like the six of
 * the Inicio (`recentTransactionsQueryOptions`). Throws an `ApiError`: `space_not_found` (404), a
 * 401, or a 422 (`cursor_invalid` when the cursor cannot be read).
 */
export async function listTransactions(
  api: ApiClient,
  spaceId: string,
  filters: TransactionFilters,
  cursor?: string | null,
  limit: number = TRANSACTIONS_PAGE_SIZE,
): Promise<MovementPage> {
  return unwrap(
    api.GET("/spaces/{space_id}/transactions", {
      params: {
        path: { space_id: spaceId },
        query: {
          ...filterQuery(filters),
          limit,
          ...(cursor ? { cursor } : {}),
        },
      },
    }),
  );
}

/**
 * What the filtered movements add up to (`GET /spaces/{space_id}/transactions/summary`): income,
 * expense and what is left, which count only confirmed incomes and expenses (never transfers nor
 * adjustments), and `count`, every movement the list would show. Same filters as the list. With
 * `accountId` it also carries `balance_change_minor` (BE-25): how much the balance of that account
 * moved in `month`, signed, with transfers and adjustments counted; it ignores `type`, `categoryId`
 * and `q`, and it is `null` without an account. Throws an `ApiError`: `space_not_found` (404), a 401
 * or a 422.
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

/** How many movements "Últimos movimientos" of the Inicio shows (docs/diseno.md D17 › Escritorio v2). */
export const RECENT_TRANSACTIONS_LIMIT = 6;

/**
 * Key of the latest movements of the Inicio (`["spaces", id, "transactions", "recent"]`), under the
 * root of the movements: registering, editing, deleting or restoring one invalidates it. It is not
 * under `"list"`, so the lists of Movimientos and `removeMovementFromListCache` do not mix with it.
 */
export function recentTransactionsKey(spaceId: string) {
  return [...transactionsQueryKey(spaceId), "recent"] as const;
}

/**
 * The latest movements of the space, newest first, for "Últimos movimientos" of the Inicio: the first
 * `RECENT_TRANSACTIONS_LIMIT` of the whole history, **with no month filter** (on the first of a month
 * a filter would leave the card empty although there is history). The data is the items alone: there is
 * no cursor, the card links to Movimientos for the rest.
 */
export function recentTransactionsQueryOptions(api: ApiClient, spaceId: string) {
  return queryOptions({
    queryKey: recentTransactionsKey(spaceId),
    queryFn: async (): Promise<MovementListItem[]> =>
      (await listTransactions(api, spaceId, {}, null, RECENT_TRANSACTIONS_LIMIT)).items,
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

// --- One movement: the detail, the edit, the delete and the restore (FE-34, KAN-99) ----------------

/**
 * One movement as the detail shows it (`GET /spaces/{space_id}/transactions/{id}`, and what `PUT` and
 * `POST .../restore` answer): the same shape as an item of the list without `balance_after_minor`.
 * `amount_minor` has a sign by type (an expense is negative) and a transfer is the unsigned amount.
 */
export type MovementRead = components["schemas"]["MovementRead"];

/** `code` of the 404 of `/transactions/{id}`: it does not exist, is deleted, or belongs to another space. */
export const TRANSACTION_NOT_FOUND = "transaction_not_found";

/**
 * `code` of the 409 of editing, deleting or restoring an adjustment, a pending or a skipped movement:
 * only a confirmed expense, income or transfer changes through the API.
 */
export const TRANSACTION_NOT_EDITABLE = "transaction_not_editable";

/** Key of the detail of one movement, under the same root as the list and the summary. */
export function transactionDetailKey(spaceId: string, transactionId: string) {
  return [...transactionsQueryKey(spaceId), "detail", transactionId] as const;
}

/**
 * One movement of the space. A deleted one, one of another space and one that does not exist are the
 * same 404 `transaction_not_found`. Throws an `ApiError`: that 404, a 401, or a 422 for an id that is
 * not a UUID.
 */
export async function getTransaction(
  api: ApiClient,
  spaceId: string,
  transactionId: string,
): Promise<MovementRead> {
  return unwrap(
    api.GET("/spaces/{space_id}/transactions/{transaction_id}", {
      params: { path: { space_id: spaceId, transaction_id: transactionId } },
    }),
  );
}

/**
 * Replaces a movement (`PUT .../transactions/{id}`, 200). The body is the **whole** movement, as when
 * registering it: what is not sent is not kept (leaving `description` out clears the note). The
 * backend would take a change of `type`, but the product does not offer it, so the form always sends
 * the movement's own. Balances, the list and the summary follow. A replace is idempotent: there is no
 * `Idempotency-Key`. Throws an `ApiError`: 404 `transaction_not_found`, 401, 409
 * `transaction_not_editable` or `account_archived` (an account the movement moves out of is
 * archived), or a 422 whose `loc` is `["body", "<type>", "<field>"]` (an account of the body archived
 * is a 422; the archived category the movement already has may be sent again).
 */
export async function updateTransaction(
  api: ApiClient,
  spaceId: string,
  transactionId: string,
  body: MovementCreate,
): Promise<MovementRead> {
  return unwrap(
    api.PUT("/spaces/{space_id}/transactions/{transaction_id}", {
      params: { path: { space_id: spaceId, transaction_id: transactionId } },
      body,
    }),
  );
}

/**
 * Deletes a movement without confirmation (`DELETE .../transactions/{id}`, 204): a soft delete, so it
 * stops counting in balances, lists and totals and `restoreTransaction` brings it back. Deleting one
 * that is already deleted is a 204 that changes nothing. Throws an `ApiError`: 404, 401, 409
 * `transaction_not_editable` (an adjustment, a pending or a skipped movement: **an adjustment cannot
 * be deleted**) or 409 `account_archived` (one of its accounts is archived).
 */
export async function deleteTransaction(
  api: ApiClient,
  spaceId: string,
  transactionId: string,
): Promise<void> {
  await unwrap(
    api.DELETE("/spaces/{space_id}/transactions/{transaction_id}", {
      params: { path: { space_id: spaceId, transaction_id: transactionId } },
    }),
  );
}

/**
 * Undoes a delete (`POST .../transactions/{id}/restore`, 200): the movement comes back identical and
 * counts again. Restoring one that is not deleted is a 200 that changes nothing. Throws an
 * `ApiError`: 404, 401, 409 `account_archived` (an account was archived meanwhile: unarchive it
 * first) or 409 `transaction_not_editable`.
 */
export async function restoreTransaction(
  api: ApiClient,
  spaceId: string,
  transactionId: string,
): Promise<MovementRead> {
  return unwrap(
    api.POST("/spaces/{space_id}/transactions/{transaction_id}/restore", {
      params: { path: { space_id: spaceId, transaction_id: transactionId } },
    }),
  );
}

const DETAIL_MAX_RETRIES = 3;

/**
 * Query options of the detail of one movement, which the edit sheet asks for when it opens.
 *
 * - **Always fresh.** `staleTime: 0` and `gcTime: 0`: nothing of an earlier opening is kept, so the form
 *   always starts from what the server says now (it reads its values once, so a cached copy could be
 *   an older edit of the same movement). Its key hangs from `transactionsQueryKey`, so a change to the
 *   movements invalidates it, and a sheet that is open refetches without resetting the form.
 * - **No retries for an answer.** A 404 (gone, deleted, another space), a 422 (not a UUID) and a 401
 *   are not going to change: they are shown at once. Anything else retries like the rest of the app.
 */
export function transactionDetailQueryOptions(
  api: ApiClient,
  spaceId: string,
  transactionId: string,
) {
  return queryOptions({
    queryKey: transactionDetailKey(spaceId, transactionId),
    queryFn: () => getTransaction(api, spaceId, transactionId),
    staleTime: 0,
    gcTime: 0,
    retry: (count, error) =>
      !(error instanceof ApiError && [401, 404, 422].includes(error.status)) &&
      count < DETAIL_MAX_RETRIES,
  });
}

/**
 * Takes a movement out of every list of the space that is in the cache (every filter, every loaded
 * page) and out of the latest movements of the Inicio, so a row that was deleted leaves the screen at
 * once, without waiting for the lists to be asked again. The caller still invalidates them: the cache
 * is only a head start, and the summary and the counts come from the server. A list that is not in
 * the cache is left alone.
 */
export function removeMovementFromListCache(
  queryClient: QueryClient,
  spaceId: string,
  transactionId: string,
): void {
  queryClient.setQueriesData<InfiniteData<MovementPage, string | null>>(
    { queryKey: [...transactionsQueryKey(spaceId), "list"] },
    (data) => {
      if (!data) return data;
      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          items: page.items.filter((item) => item.id !== transactionId),
        })),
      };
    },
  );
  queryClient.setQueryData<MovementListItem[]>(recentTransactionsKey(spaceId), (items) =>
    items?.filter((item) => item.id !== transactionId),
  );
}

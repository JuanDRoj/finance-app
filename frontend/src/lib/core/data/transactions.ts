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
 * The list of Movimientos (FE-22) hangs its keys from it, so invalidating this one refreshes it
 * after a movement is registered, edited or deleted.
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

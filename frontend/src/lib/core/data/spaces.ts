import type { components } from "@/lib/api/schema";
import type { ApiClient } from "./api-client";
import { unwrap } from "./errors";

/** A space with its currency (code and ISO 4217 exponent) and its time zone. */
export type SpaceRead = components["schemas"]["SpaceRead"];

/**
 * Root of every query key of a space: `["spaces"]` for the list and `["spaces", spaceId, ...]` for
 * what lives inside one (its accounts, later its movements). Invalidating `["spaces"]` after a
 * change of currency refreshes all of it, which is what a new currency asks for: every amount is
 * read with another exponent.
 */
export function spaceQueryKey(spaceId: string) {
  return ["spaces", spaceId] as const;
}

/**
 * The spaces where the user is a member, oldest first (the personal space comes first). Throws an
 * `ApiError`: `not_authenticated` or `invalid_session` (401).
 * Query options (key `["spaces"]`) are added with the first Client Component that needs them.
 */
export async function listSpaces(api: ApiClient): Promise<SpaceRead[]> {
  return unwrap(api.GET("/spaces"));
}

/**
 * Changes the currency of a space (`PATCH /spaces/{space_id}`) and returns the space as it is now.
 * Asking for the currency it already has changes nothing and is never refused. Throws an
 * `ApiError`: `space_not_found` (404), `space_has_transactions` (409: the space has movements,
 * `SpaceRead.currency_locked`), a 422 `currency_unsupported`, or a 401.
 */
export async function updateSpaceCurrency(
  api: ApiClient,
  spaceId: string,
  currency: string,
): Promise<SpaceRead> {
  return unwrap(
    api.PATCH("/spaces/{space_id}", {
      params: { path: { space_id: spaceId } },
      body: { currency },
    }),
  );
}

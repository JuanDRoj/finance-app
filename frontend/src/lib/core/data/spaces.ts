import type { components } from "@/lib/api/schema";
import type { ApiClient } from "./api-client";
import { unwrap } from "./errors";

/** A space with its currency (code and ISO 4217 exponent) and its time zone. */
export type SpaceRead = components["schemas"]["SpaceRead"];

/**
 * The spaces where the user is a member, oldest first (the personal space comes first). Throws an
 * `ApiError`: `not_authenticated` or `invalid_session` (401).
 * Query options (key `["spaces"]`) are added with the first Client Component that needs them.
 */
export async function listSpaces(api: ApiClient): Promise<SpaceRead[]> {
  return unwrap(api.GET("/spaces"));
}

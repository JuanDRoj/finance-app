import type { components } from "@/lib/api/schema";
import type { ApiClient } from "./api-client";
import { unwrap } from "./errors";

/** The logged-in user (`GET /me`). `display_name` is optional: see `displayNameOf`. */
export type UserRead = components["schemas"]["UserRead"];

/**
 * The logged-in user. Throws an `ApiError`: `not_authenticated` or `invalid_session` (401).
 * Query options (key `["me"]`) are added with the first Client Component that needs them.
 */
export async function getMe(api: ApiClient): Promise<UserRead> {
  return unwrap(api.GET("/me"));
}

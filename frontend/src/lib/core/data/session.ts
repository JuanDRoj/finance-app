import type { components } from "@/lib/api/schema";
import type { ApiClient } from "./api-client";
import { unwrap } from "./errors";

/** Body of `POST /auth/session`: the Firebase ID token and the device's IANA time zone. */
export type SessionCreate = components["schemas"]["SessionCreate"];

/**
 * Exchanges a fresh Firebase ID token for the session cookie (HttpOnly, 14 days). The cookie is
 * set by the response itself, so the function returns nothing. The first login also creates the
 * user and their personal space in `timezone`.
 *
 * Throws an `ApiError`: `invalid_id_token`, `email_required` or `recent_sign_in_required` (401),
 * `origin_not_allowed` (403) or a 422 with `timezone_invalid`.
 */
export async function createSession(api: ApiClient, body: SessionCreate): Promise<void> {
  await unwrap(api.POST("/auth/session", { body }));
}

/**
 * Logs out everywhere: the backend revokes the user's sessions in Firebase and clears the cookie.
 * It answers 204 in every case (also without a session, with an invalid cookie, or when Firebase
 * cannot be reached), so the only failures are a 403 `origin_not_allowed` and a network error.
 */
export async function deleteSession(api: ApiClient): Promise<void> {
  await unwrap(api.DELETE("/auth/session"));
}

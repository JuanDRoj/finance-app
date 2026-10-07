import "server-only";
import { headers } from "next/headers";
import createClient from "openapi-fetch";
import { serverEnv } from "@/lib/env/server";
import { pickCookie } from "./cookie-header";
import type { paths } from "./schema";

/**
 * API client for Server Components, route handlers and server functions.
 *
 * It calls BACKEND_URL directly (no /api rewrite) and forwards only the session cookie of the
 * incoming request: `SESSION_COOKIE_NAME` (`session` locally, `__Host-session` in staging and
 * production, the name the backend uses). Any other cookie of the browser stays in Next.js. The
 * cookie is taken from the raw `Cookie` header and forwarded verbatim (not rebuilt from
 * `cookies()`, which re-encodes values). Without a session cookie no `Cookie` header is sent and
 * the backend answers 401.
 *
 * Reading the request headers makes the calling route dynamic. Create the client once per
 * render: `const api = await getServerApi();`.
 */
export async function getServerApi() {
  const cookie = pickCookie((await headers()).get("cookie"), serverEnv.SESSION_COOKIE_NAME);

  return createClient<paths>({
    baseUrl: serverEnv.BACKEND_URL,
    // Per-user data must never be served from Next's Data Cache.
    cache: "no-store",
    ...(cookie ? { headers: { cookie } } : {}),
  });
}

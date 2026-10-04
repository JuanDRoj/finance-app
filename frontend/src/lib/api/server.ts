import "server-only";
import { headers } from "next/headers";
import createClient from "openapi-fetch";
import { serverEnv } from "@/lib/env/server";
import type { paths } from "./schema";

/**
 * API client for Server Components, route handlers and server functions.
 *
 * It calls BACKEND_URL directly (no /api rewrite) and forwards the incoming `Cookie` header as
 * is, so the backend sees the same session cookie the browser sent to Next.js. The header is
 * forwarded verbatim (not rebuilt from `cookies()`, which re-encodes values).
 *
 * Reading the request headers makes the calling route dynamic. Create the client once per
 * render: `const api = await getServerApi();`.
 */
export async function getServerApi() {
  const cookie = (await headers()).get("cookie");

  return createClient<paths>({
    baseUrl: serverEnv.BACKEND_URL,
    // Per-user data must never be served from Next's Data Cache.
    cache: "no-store",
    ...(cookie ? { headers: { cookie } } : {}),
  });
}

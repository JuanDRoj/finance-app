import createClient from "openapi-fetch";
import type { paths } from "./schema";

/**
 * API client for the browser (Client Components, event handlers, effects).
 *
 * `/api/*` is rewritten by next.config.ts to `${BACKEND_URL}/*`, so the browser only talks to
 * the Next.js origin and the HttpOnly session cookie travels with `credentials: "include"`.
 *
 * Browser only: a relative baseUrl cannot be resolved in Node, so using it in a Server
 * Component fails with "Failed to parse URL". Use `getServerApi()` there.
 */
export const browserApi = createClient<paths>({
  baseUrl: "/api",
  credentials: "include",
});

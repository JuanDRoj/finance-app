import type { Client } from "openapi-fetch";
import type { paths } from "@/lib/api/schema";

/**
 * The only port core depends on: data functions receive an `ApiClient` instead of importing
 * one. `getServerApi()` (server) and `browserApi` (browser) both satisfy it.
 */
export type ApiClient = Client<paths>;

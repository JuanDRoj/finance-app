/**
 * Type-level contract check, verified by `npm run typecheck`. Nothing imports this file and
 * none of the functions run: it exists so that `tsc` fails when schema.d.ts (generated from
 * backend/openapi.json) stops matching what the frontend relies on.
 *
 * - If the backend renames or removes `/healthz` or `HealthResponse.status`, the valid calls
 *   below stop compiling.
 * - If the client stops rejecting a wrong call, an unused `@ts-expect-error` stops compiling.
 *
 * When a real endpoint lands, prefer its own use in the app; keep this file as the canary for
 * the typed-client wiring.
 */
import { browserApi } from "./browser";
import { getServerApi } from "./server";

export async function serverClientIsTyped(): Promise<string> {
  const api = await getServerApi();
  const { data } = await api.GET("/healthz");
  const status: string | undefined = data?.status;

  // @ts-expect-error unknown path
  await api.GET("/does-not-exist");
  // @ts-expect-error /healthz only allows GET
  await api.POST("/healthz");
  // @ts-expect-error `nope` is not a field of HealthResponse
  void data?.nope;
  // @ts-expect-error `status` is a string, not a number
  const wrong: number | undefined = data?.status;
  void wrong;

  return status ?? "";
}

export async function browserClientIsTyped(): Promise<string> {
  const { data } = await browserApi.GET("/healthz");
  const status: string | undefined = data?.status;

  // @ts-expect-error unknown path
  await browserApi.GET("/does-not-exist");
  // @ts-expect-error /healthz only allows GET
  await browserApi.POST("/healthz");

  return status ?? "";
}

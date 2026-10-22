import { queryOptions } from "@tanstack/react-query";
import type { components } from "@/lib/api/schema";
import type { ApiClient } from "./api-client";
import { unwrap } from "./errors";

/** A currency the backend supports: ISO 4217 code and exponent (`name` is not sent: see `CURRENCY_NAMES`). */
export type CurrencyRead = components["schemas"]["CurrencyRead"];

/**
 * The currencies a space can use (`GET /currencies`, the six the backend seeds), in the order the
 * backend lists them. Throws an `ApiError`: `not_authenticated` or `invalid_session` (401).
 */
export async function listCurrencies(api: ApiClient): Promise<CurrencyRead[]> {
  return unwrap(api.GET("/currencies"));
}

/** The list is global and almost never changes: five minutes before it is asked again. */
const CURRENCIES_STALE_TIME_MS = 5 * 60_000;

/** Query options of the currency list (key `["currencies"]`; it belongs to no space). */
export function currenciesQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: ["currencies"] as const,
    queryFn: () => listCurrencies(api),
    staleTime: CURRENCIES_STALE_TIME_MS,
  });
}

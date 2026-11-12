import { queryOptions } from "@tanstack/react-query";
import type { components, paths } from "@/lib/api/schema";
import type { ApiClient } from "./api-client";
import { unwrap } from "./errors";
import { transactionsQueryKey } from "./transactions";

// The data of the Inicio (FE-35, KAN-101; the screen is KAN-84): the dashboard of the month and the
// series of the last months. Amounts are in the minor unit of the currency of the space.

/**
 * What the Inicio shows (`GET /spaces/{space_id}/dashboard`, BE-21): Disponible, Deuda de tarjetas and
 * Neto (the ones of `balance-summary`, archived accounts included), the current month of the space
 * (`month`, `YYYY-MM`), what was spent in it (`month_expense_minor`, the denominator of the
 * percentages) and the top 5 categories.
 */
export type DashboardRead = components["schemas"]["DashboardRead"];

/**
 * A main category of the top of the month, with its subcategories added in: `amount_minor` (positive)
 * and `percentage`, a whole percent of `month_expense_minor` (so the rows need not add up to 100).
 * `category_id` is the main category: filtering Movimientos by it includes its subcategories.
 */
export type TopExpenseCategory = components["schemas"]["TopExpenseCategory"];

/** The months of the Inicio's charts, oldest first; the last one is the current month. */
export type DashboardSeries = components["schemas"]["DashboardSeriesRead"];

/**
 * One month of the series: `income_minor` and `expense_minor` (both positive) of the whole month, and
 * `net_minor`, the net at the close of the month (in the current one, the net of today).
 */
export type MonthlySeriesPoint = components["schemas"]["MonthlySeriesPoint"];

/** How many months the Inicio asks for: six, the backend's default, counting the current one. */
export const DASHBOARD_SERIES_MONTHS = 6;

// Contract check: the aliases above must be what the endpoints answer. If the backend renames or
// reshapes either response, `npm run typecheck` fails here instead of the screen quietly drifting.
type DashboardOfApi =
  paths["/spaces/{space_id}/dashboard"]["get"]["responses"]["200"]["content"]["application/json"];
type SeriesOfApi =
  paths["/spaces/{space_id}/dashboard/series"]["get"]["responses"]["200"]["content"]["application/json"];
const _dashboardAlias: DashboardOfApi = {} as DashboardRead;
const _dashboardApi: DashboardRead = {} as DashboardOfApi;
const _seriesAlias: SeriesOfApi = {} as DashboardSeries;
const _seriesApi: DashboardSeries = {} as SeriesOfApi;
void [_dashboardAlias, _dashboardApi, _seriesAlias, _seriesApi];

/**
 * Key of the dashboard of a space. It hangs from the root of the **movements** on purpose
 * (`["spaces", id, "transactions", "dashboard"]`): every figure of the Inicio comes from the movements,
 * so registering, editing, deleting or restoring one (which invalidate that root) refreshes it, with
 * no mutation having to know the Inicio exists. What changes the accounts invalidates `["spaces", id]`,
 * which covers it too.
 */
export function dashboardKey(spaceId: string) {
  return [...transactionsQueryKey(spaceId), "dashboard"] as const;
}

/** Key of the series (`["spaces", id, "transactions", "dashboard-series", months]`), under the same root. */
export function dashboardSeriesKey(spaceId: string, months: number = DASHBOARD_SERIES_MONTHS) {
  return [...transactionsQueryKey(spaceId), "dashboard-series", months] as const;
}

/**
 * The dashboard of the current month of the space (`GET /spaces/{space_id}/dashboard`). Throws an
 * `ApiError`: `space_not_found` (404) or a 401.
 */
export async function getDashboard(api: ApiClient, spaceId: string): Promise<DashboardRead> {
  return unwrap(
    api.GET("/spaces/{space_id}/dashboard", { params: { path: { space_id: spaceId } } }),
  );
}

/**
 * Income, expense and net at the close of each of the last `months` (1 to 12) months
 * (`GET /spaces/{space_id}/dashboard/series`): exactly that many points, oldest first, the last one
 * the current month of the space. Throws an `ApiError`: `space_not_found` (404), a 401, or a 422 for
 * a `months` outside 1 to 12.
 */
export async function getDashboardSeries(
  api: ApiClient,
  spaceId: string,
  months: number = DASHBOARD_SERIES_MONTHS,
): Promise<DashboardSeries> {
  return unwrap(
    api.GET("/spaces/{space_id}/dashboard/series", {
      params: { path: { space_id: spaceId }, query: { months } },
    }),
  );
}

/** Query options of the dashboard (key `dashboardKey`). */
export function dashboardQueryOptions(api: ApiClient, spaceId: string) {
  return queryOptions({
    queryKey: dashboardKey(spaceId),
    queryFn: () => getDashboard(api, spaceId),
  });
}

/** Query options of the series of the last `months` months (key `dashboardSeriesKey`). */
export function dashboardSeriesQueryOptions(
  api: ApiClient,
  spaceId: string,
  months: number = DASHBOARD_SERIES_MONTHS,
) {
  return queryOptions({
    queryKey: dashboardSeriesKey(spaceId, months),
    queryFn: () => getDashboardSeries(api, spaceId, months),
  });
}

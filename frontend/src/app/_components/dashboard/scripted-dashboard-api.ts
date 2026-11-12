import { scriptedMovementsApi } from "@/components/movements/scripted-movements-api";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { MonthlySeriesPoint } from "@/lib/core/data/dashboard";
import { shiftMonth } from "@/lib/core/movements";
import type { DashboardScenario } from "./dashboard-fixtures";

// A **scripted API client** for the Inicio (FE-35, KAN-101): the little backend that the tests of the
// dashboard and its section of the catalog talk to, since the catalog has no session. It answers
// `GET /spaces/{id}/dashboard` and `/dashboard/series` with what the scenario says, and `GET
// /accounts` and `GET /transactions` (the six latest movements of "Últimos movimientos", with `limit`)
// through the scripted API of Movimientos, so a movement that is edited or deleted from a row of the
// Inicio goes through the same fake as on its own screen. A test or a demo says what goes wrong
// (`fault`) and how long it takes (`delay`) by kind of request. Not used by the app.

/** Which request it is: the dashboard, the series, the latest movements or the accounts. */
export type DashboardCallKind = "dashboard" | "series" | "recent" | "accounts";

/**
 * What goes wrong: a 500, no connection (`fetch` rejects), a request that never answers, or the 404
 * `space_not_found` of a space that is not the person's.
 */
export type DashboardFault = "server" | "offline" | "never" | "not-found";

export type ScriptedDashboardCall = {
  kind: DashboardCallKind;
  path: string;
  query: Record<string, string | number | boolean | undefined>;
};

export type ScriptedDashboardOptions = {
  /** The case the Inicio is shown with. Read at every request, so a test or a selector can change it. */
  scenario: () => DashboardScenario;
  /** Fails a request, or not (`undefined`). */
  fault?: (call: ScriptedDashboardCall) => DashboardFault | undefined;
  /** Milliseconds to wait before answering. */
  delay?: (call: ScriptedDashboardCall) => number;
};

export type ScriptedDashboardApi = ApiClient & {
  /** Every request of the four kinds made, in order. */
  calls: ScriptedDashboardCall[];
};

const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) });
const failure = (status: number, error: unknown) => ({
  error,
  response: new Response(null, { status }),
});

/** How many months `GET /dashboard/series` accepts: 1 to 12, 6 by default (a 422 otherwise). */
const SERIES_DEFAULT = 6;
const SERIES_MIN = 1;
const SERIES_MAX = 12;

/**
 * The last `months` points of the scenario's series; if it has fewer, the months before them with 0 in
 * everything, as the backend fills "where there is nothing" (it always returns exactly the months asked).
 */
function seriesOf(points: readonly MonthlySeriesPoint[], months: number): MonthlySeriesPoint[] {
  const last = points.slice(-months);
  const missing = months - last.length;
  const first = last[0];
  const before: MonthlySeriesPoint[] = [];
  for (let step = missing; step >= 1 && first; step -= 1) {
    const month = shiftMonth(first.month, -step);
    if (month) before.push({ month, income_minor: 0, expense_minor: 0, net_minor: 0 });
  }
  return [...before, ...last];
}

type Query = ScriptedDashboardCall["query"];
type Init = { params?: { query?: Query } };

export function scriptedDashboardApi({
  scenario,
  fault,
  delay,
}: ScriptedDashboardOptions): ScriptedDashboardApi {
  const calls: ScriptedDashboardCall[] = [];
  // The movements, the accounts and the edits of a movement are those of Movimientos' fake; the faults
  // and the delays of the four kinds above are decided here, so the inner one gets none.
  const inner = scriptedMovementsApi({
    items: () => scenario().movements,
    accounts: () => scenario().accounts,
  });

  function kindOf(path: string): DashboardCallKind | undefined {
    if (path.endsWith("/dashboard/series")) return "series";
    if (path.endsWith("/dashboard")) return "dashboard";
    if (path.endsWith("/accounts")) return "accounts";
    if (path.endsWith("/transactions")) return "recent";
    return undefined;
  }

  /** Waits, then fails the way `fault` says. `undefined` means: answer normally. */
  async function begin(call: ScriptedDashboardCall) {
    calls.push(call);
    const wait = delay?.(call) ?? 0;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const problem = fault?.(call);
    if (problem === "never") return new Promise<never>(() => {});
    if (problem === "offline") throw new TypeError("Failed to fetch");
    if (problem === "server") {
      return failure(500, { code: "internal_error", detail: "Internal server error" });
    }
    if (problem === "not-found") {
      return failure(404, { code: "space_not_found", detail: "Space not found" });
    }
    return undefined;
  }

  async function get(path: string, init?: Init) {
    const kind = kindOf(path);
    // Anything else (the summary, one movement) is Movimientos' fake, untouched.
    if (!kind) return (inner.GET as (path: string, init?: Init) => unknown)(path, init);
    const query = init?.params?.query ?? {};
    const problem = await begin({ kind, path, query });
    if (problem) return problem;

    const current = scenario();
    if (kind === "dashboard") return ok(current.dashboard);
    if (kind === "series") {
      const months = query.months === undefined ? SERIES_DEFAULT : query.months;
      if (typeof months !== "number" || !Number.isInteger(months) || months < SERIES_MIN) {
        return failure(422, {
          detail: [{ type: "greater_than_equal", loc: ["query", "months"], msg: "too few" }],
        });
      }
      if (months > SERIES_MAX) {
        return failure(422, {
          detail: [{ type: "less_than_equal", loc: ["query", "months"], msg: "too many" }],
        });
      }
      return ok({ points: seriesOf(current.series, months) });
    }
    // Accounts and the list of movements: the same answer as on their own screens.
    return (inner.GET as (path: string, init?: Init) => unknown)(path, init);
  }

  const client = {
    calls,
    GET: get,
    PUT: inner.PUT,
    DELETE: inner.DELETE,
    POST: inner.POST,
  };
  return client as unknown as ScriptedDashboardApi;
}

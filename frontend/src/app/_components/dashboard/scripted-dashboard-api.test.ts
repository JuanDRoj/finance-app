import { readFileSync } from "node:fs";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listAccounts } from "@/lib/core/data/accounts";
import { getDashboard, getDashboardSeries } from "@/lib/core/data/dashboard";
import {
  deleteTransaction,
  getTransaction,
  getTransactionsSummary,
  listTransactions,
  recentTransactionsQueryOptions,
} from "@/lib/core/data/transactions";
import { DASHBOARD_SCENARIOS, type DashboardScenario } from "./dashboard-fixtures";
import {
  scriptedDashboardApi,
  type DashboardFault,
  type ScriptedDashboardCall,
} from "./scripted-dashboard-api";

// The little backend of the Inicio (FE-35): the tests of the dashboard and the catalog trust it, so
// it has to answer as the real one does (docs/arquitectura-backend.md §7): the dashboard of the
// month, exactly the months asked of the series, and the latest movements and the accounts.

const SPACE = "00000000-0000-4000-8000-0000000000aa";
const CANVAS = DASHBOARD_SCENARIOS.canvas;

function setup(
  options: {
    scenario?: () => DashboardScenario;
    fault?: (call: ScriptedDashboardCall) => DashboardFault | undefined;
    delay?: (call: ScriptedDashboardCall) => number;
  } = {},
) {
  return scriptedDashboardApi({ scenario: () => CANVAS, ...options });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the dashboard and the series", () => {
  it("answers the dashboard of the scenario, as the app reads it", async () => {
    await expect(getDashboard(setup(), SPACE)).resolves.toEqual(CANVAS.dashboard);
  });

  it("answers the six months of the scenario by default, oldest first", async () => {
    const { points } = await getDashboardSeries(setup(), SPACE);
    expect(points).toEqual(CANVAS.series);
    expect(points.map((p) => p.month)).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
  });

  it("answers exactly the months asked: the last ones, and zeros before the scenario's first", async () => {
    const api = setup();
    const three = await getDashboardSeries(api, SPACE, 3);
    expect(three.points).toEqual(CANVAS.series.slice(-3));
    const one = await getDashboardSeries(api, SPACE, 1);
    expect(one.points).toEqual(CANVAS.series.slice(-1));

    const twelve = await getDashboardSeries(api, SPACE, 12);
    expect(twelve.points).toHaveLength(12);
    expect(twelve.points.slice(-6)).toEqual(CANVAS.series);
    expect(twelve.points.slice(0, 6)).toEqual(
      ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04"].map((month) => ({
        month,
        income_minor: 0,
        expense_minor: 0,
        net_minor: 0,
      })),
    );
  });

  it("is a 422 on the query for a number of months outside 1 to 12, as the real one is", async () => {
    const api = setup();
    for (const months of [0, -1, 13, 2.5]) {
      await expect(getDashboardSeries(api, SPACE, months)).rejects.toMatchObject({
        status: 422,
        body: { detail: [{ loc: ["query", "months"] }] },
      });
    }
    await expect(getDashboardSeries(api, SPACE, 12)).resolves.toBeDefined();
    await expect(getDashboardSeries(api, SPACE, 1)).resolves.toBeDefined();
  });

  it("reads the scenario at every request, so a selector can change it", async () => {
    let current = DASHBOARD_SCENARIOS.canvas;
    const api = setup({ scenario: () => current });
    expect((await getDashboard(api, SPACE)).net_minor).toBe(9_643_000);
    current = DASHBOARD_SCENARIOS["negative-net"];
    expect((await getDashboard(api, SPACE)).net_minor).toBe(-350_000);
    expect((await getDashboardSeries(api, SPACE)).points.at(-1)?.net_minor).toBe(-350_000);
  });
});

describe("the latest movements and the accounts", () => {
  it("lists the six latest movements, newest first, with the limit the Inicio asks", async () => {
    const items = await new QueryClient().fetchQuery(
      recentTransactionsQueryOptions(setup(), SPACE),
    );
    expect(items).toHaveLength(6);
    expect(items.map((item) => item.date)).toEqual([
      "2026-10-20",
      "2026-10-19",
      "2026-10-18",
      "2026-10-17",
      "2026-10-16",
      "2026-10-15",
    ]);
    expect(items[3]).toMatchObject({ type: "transfer", description: "Pago de Visa Itaú" });
  });

  it("gives the movements of the scenario, fewer than six included", async () => {
    const api = setup({ scenario: () => DASHBOARD_SCENARIOS["no-expenses"] });
    const items = await new QueryClient().fetchQuery(recentTransactionsQueryOptions(api, SPACE));
    expect(items.map((item) => item.type)).toEqual(["transfer", "income"]);
    const none = setup({ scenario: () => DASHBOARD_SCENARIOS["no-movements"] });
    await expect(
      new QueryClient().fetchQuery(recentTransactionsQueryOptions(none, SPACE)),
    ).resolves.toEqual([]);
  });

  it("lists the active accounts of the scenario", async () => {
    await expect(listAccounts(setup(), SPACE)).resolves.toEqual(CANVAS.accounts);
  });

  it("passes the rest to the fake of Movimientos: the summary, one movement and its edits", async () => {
    const api = setup();
    const first = CANVAS.movements[0]!;
    await expect(getTransactionsSummary(api, SPACE, { month: "2026-10" })).resolves.toMatchObject({
      expense_minor: 234_000 + 38_000 + 64_000 + 215_000 + 90_000 + 39_000,
    });
    await expect(getTransaction(api, SPACE, first.id)).resolves.toMatchObject({ id: first.id });

    // A movement deleted from a row of the Inicio leaves the latest movements: the same fake serves both.
    await deleteTransaction(api, SPACE, first.id);
    const page = await listTransactions(api, SPACE, {}, null, 6);
    expect(page.items.map((item) => item.id)).not.toContain(first.id);
    expect(page.items).toHaveLength(6);
  });
});

describe("what goes wrong, by request", () => {
  async function outcome(promise: Promise<unknown>) {
    return promise.then(
      () => "ok",
      (error: unknown) => (error as { status?: number }).status ?? String(error),
    );
  }

  it("fails only the kind of request it is told to, with a 500", async () => {
    const api = setup({ fault: (call) => (call.kind === "series" ? "server" : undefined) });
    expect(await outcome(getDashboardSeries(api, SPACE))).toBe(500);
    expect(await outcome(getDashboard(api, SPACE))).toBe("ok");
    expect(await outcome(listAccounts(api, SPACE))).toBe("ok");
    expect(
      await outcome(new QueryClient().fetchQuery(recentTransactionsQueryOptions(api, SPACE))),
    ).toBe("ok");
  });

  it("fails each of the four kinds on its own", async () => {
    for (const kind of ["dashboard", "series", "recent", "accounts"] as const) {
      const api = setup({ fault: (call) => (call.kind === kind ? "server" : undefined) });
      const results = {
        dashboard: await outcome(getDashboard(api, SPACE)),
        series: await outcome(getDashboardSeries(api, SPACE)),
        recent: await outcome(
          new QueryClient().fetchQuery(recentTransactionsQueryOptions(api, SPACE)),
        ),
        accounts: await outcome(listAccounts(api, SPACE)),
      };
      expect(results).toEqual({
        dashboard: "ok",
        series: "ok",
        recent: "ok",
        accounts: "ok",
        [kind]: 500,
      });
    }
  });

  it("offline rejects the request like a fetch with no connection", async () => {
    const api = setup({ fault: () => "offline" });
    await expect(getDashboard(api, SPACE)).rejects.toThrow(TypeError);
    await expect(listAccounts(api, SPACE)).rejects.toThrow("Failed to fetch");
  });

  it("not-found answers the 404 of a space that is not the person's", async () => {
    const api = setup({ fault: () => "not-found" });
    await expect(getDashboard(api, SPACE)).rejects.toMatchObject({
      status: 404,
      body: { code: "space_not_found" },
    });
  });

  it("never does not answer", async () => {
    const api = setup({ fault: () => "never" });
    const settled = vi.fn();
    void getDashboard(api, SPACE).then(settled, settled);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).not.toHaveBeenCalled();
  });

  it("waits the delay of each kind before answering", async () => {
    vi.useFakeTimers();
    const api = setup({ delay: (call) => (call.kind === "series" ? 1500 : 0) });
    const done = vi.fn();
    void getDashboardSeries(api, SPACE).then(done);
    await vi.advanceTimersByTimeAsync(1400);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toHaveBeenCalledTimes(1);
    // The dashboard has no delay.
    await expect(getDashboard(api, SPACE)).resolves.toBeDefined();
  });

  it("records each request of the four kinds, in order, with its query", async () => {
    const api = setup();
    await getDashboard(api, SPACE);
    await getDashboardSeries(api, SPACE, 6);
    await listTransactions(api, SPACE, {}, null, 6);
    await listAccounts(api, SPACE);
    expect(api.calls.map((call) => call.kind)).toEqual([
      "dashboard",
      "series",
      "recent",
      "accounts",
    ]);
    expect(api.calls[1]?.query).toEqual({ months: 6 });
    expect(api.calls[2]?.query).toMatchObject({ limit: 6 });
  });
});

describe("what it does not borrow", () => {
  it("does not import, nor name, the app's rules for the dashboard: the fake and what it is checked with are apart", () => {
    for (const file of ["scripted-dashboard-api.ts", "dashboard-fixtures.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/from "@\/lib\/core\/dashboard"/);
      expect(source, file).not.toMatch(/from "@\/lib\/core\/accounts-summary"/);
      expect(source, file).not.toMatch(/from "\.\.\/\.\.\/\.\.\/lib\/core\/dashboard"/);
    }
  });
});

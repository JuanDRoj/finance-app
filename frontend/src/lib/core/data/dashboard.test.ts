import { QueryClient } from "@tanstack/react-query";
import createClient from "openapi-fetch";
import { describe, expect, it, vi } from "vitest";
import type { paths } from "@/lib/api/schema";
import {
  DASHBOARD_SERIES_MONTHS,
  dashboardKey,
  dashboardQueryOptions,
  dashboardSeriesKey,
  dashboardSeriesQueryOptions,
  getDashboard,
  getDashboardSeries,
  type DashboardRead,
  type DashboardSeries,
} from "./dashboard";
import { spaceQueryKey } from "./spaces";
import { recentTransactionsKey, transactionsQueryKey } from "./transactions";

function clientAnswering(response: Response) {
  const fetch = vi.fn<(request: Request) => Promise<Response>>(async () => response);
  return { api: createClient<paths>({ baseUrl: "http://backend.test", fetch }), fetch };
}

const SPACE_ID = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0001";

const DASHBOARD: DashboardRead = {
  month: "2026-10",
  available_minor: 12890000,
  card_debt_minor: 3247000,
  net_minor: 9643000,
  month_expense_minor: 3677000,
  top_expense_categories: [
    {
      category_id: "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0011",
      name: "Comida",
      icon: "fork-knife",
      amount_minor: 2123000,
      percentage: 58,
    },
  ],
};

const SERIES: DashboardSeries = {
  points: [
    { month: "2026-09", income_minor: 6800000, expense_minor: 3980000, net_minor: 9210000 },
    { month: "2026-10", income_minor: 6800000, expense_minor: 3677000, net_minor: 9643000 },
  ],
};

describe("the keys of the Inicio", () => {
  it("hang from the root of the movements, so registering or editing one refreshes them", () => {
    expect(dashboardKey(SPACE_ID)).toEqual(["spaces", SPACE_ID, "transactions", "dashboard"]);
    expect(dashboardSeriesKey(SPACE_ID)).toEqual([
      "spaces",
      SPACE_ID,
      "transactions",
      "dashboard-series",
      6,
    ]);
    expect(dashboardKey(SPACE_ID).slice(0, 3)).toEqual(transactionsQueryKey(SPACE_ID));
    expect(dashboardSeriesKey(SPACE_ID).slice(0, 3)).toEqual(transactionsQueryKey(SPACE_ID));
  });

  it("tell the series of 6 months from those of another length", () => {
    expect(dashboardSeriesKey(SPACE_ID, 12)).not.toEqual(dashboardSeriesKey(SPACE_ID, 6));
    expect(dashboardSeriesKey(SPACE_ID)).toEqual(dashboardSeriesKey(SPACE_ID, 6));
  });

  it("are invalidated, the dashboard, the series and the latest movements, by the root of the movements", async () => {
    // What registering, editing, deleting and restoring a movement do (`invalidateQueries` on this root).
    const client = new QueryClient();
    const keys = [
      dashboardKey(SPACE_ID),
      dashboardSeriesKey(SPACE_ID),
      recentTransactionsKey(SPACE_ID),
    ];
    const otherSpace = dashboardKey("another-space");
    for (const key of [...keys, otherSpace]) client.setQueryData(key, {});

    await client.invalidateQueries({ queryKey: transactionsQueryKey(SPACE_ID) });

    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherSpace)?.isInvalidated).toBe(false);
  });

  it("are invalidated by the root of the space too, which is what the accounts' mutations use", async () => {
    const client = new QueryClient();
    const keys = [dashboardKey(SPACE_ID), dashboardSeriesKey(SPACE_ID)];
    for (const key of keys) client.setQueryData(key, {});
    await client.invalidateQueries({ queryKey: spaceQueryKey(SPACE_ID) });
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });
});

describe("getDashboard", () => {
  it("sends GET /spaces/{id}/dashboard and returns the dashboard as the backend wrote it", async () => {
    const { api, fetch } = clientAnswering(Response.json(DASHBOARD));
    await expect(getDashboard(api, SPACE_ID)).resolves.toEqual(DASHBOARD);
    const request = fetch.mock.calls[0]![0];
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe(`/spaces/${SPACE_ID}/dashboard`);
    expect(new URL(request.url).search).toBe("");
  });

  it("throws an ApiError with the code of a 404 and with the status of a 401", async () => {
    const notFound = clientAnswering(
      Response.json({ code: "space_not_found", detail: "x" }, { status: 404 }),
    );
    await expect(getDashboard(notFound.api, SPACE_ID)).rejects.toMatchObject({
      status: 404,
      body: { code: "space_not_found" },
    });
    const unauthorized = clientAnswering(
      Response.json({ code: "not_authenticated", detail: "x" }, { status: 401 }),
    );
    await expect(getDashboard(unauthorized.api, SPACE_ID)).rejects.toMatchObject({ status: 401 });
  });

  it("throws on an empty 502 too: a failed dashboard is never taken for an empty one", async () => {
    const { api } = clientAnswering(new Response(null, { status: 502 }));
    await expect(getDashboard(api, SPACE_ID)).rejects.toMatchObject({ status: 502 });
  });
});

describe("getDashboardSeries", () => {
  it("asks for 6 months by default, which is what the Inicio draws", async () => {
    const { api, fetch } = clientAnswering(Response.json(SERIES));
    await expect(getDashboardSeries(api, SPACE_ID)).resolves.toEqual(SERIES);
    const url = new URL(fetch.mock.calls[0]![0].url);
    expect(url.pathname).toBe(`/spaces/${SPACE_ID}/dashboard/series`);
    expect(Object.fromEntries(url.searchParams.entries())).toEqual({ months: "6" });
    expect(DASHBOARD_SERIES_MONTHS).toBe(6);
  });

  it("asks for as many months as the caller says", async () => {
    const { api, fetch } = clientAnswering(Response.json(SERIES));
    await getDashboardSeries(api, SPACE_ID, 12);
    expect(new URL(fetch.mock.calls[0]![0].url).searchParams.get("months")).toBe("12");
  });

  it("throws the 422 of a month count out of range, with its body for the caller to read", async () => {
    const body = {
      detail: [{ type: "less_than_equal", loc: ["query", "months"], msg: "too many" }],
    };
    const { api } = clientAnswering(Response.json(body, { status: 422 }));
    await expect(getDashboardSeries(api, SPACE_ID, 13)).rejects.toMatchObject({
      status: 422,
      body,
    });
  });
});

describe("dashboardQueryOptions and dashboardSeriesQueryOptions", () => {
  it("use their keys and call their endpoints", async () => {
    const dashboard = clientAnswering(Response.json(DASHBOARD));
    const options = dashboardQueryOptions(dashboard.api, SPACE_ID);
    expect(options.queryKey).toEqual(dashboardKey(SPACE_ID));
    await expect(new QueryClient().fetchQuery(options)).resolves.toEqual(DASHBOARD);
    expect(new URL(dashboard.fetch.mock.calls[0]![0].url).pathname).toBe(
      `/spaces/${SPACE_ID}/dashboard`,
    );

    const series = clientAnswering(Response.json(SERIES));
    const seriesOptions = dashboardSeriesQueryOptions(series.api, SPACE_ID);
    expect(seriesOptions.queryKey).toEqual(dashboardSeriesKey(SPACE_ID, 6));
    await expect(new QueryClient().fetchQuery(seriesOptions)).resolves.toEqual(SERIES);
    expect(new URL(series.fetch.mock.calls[0]![0].url).pathname).toBe(
      `/spaces/${SPACE_ID}/dashboard/series`,
    );
  });

  it("put the months in the key and in the request together, so two lengths never share data", async () => {
    const { api, fetch } = clientAnswering(Response.json(SERIES));
    const options = dashboardSeriesQueryOptions(api, SPACE_ID, 12);
    expect(options.queryKey).toEqual(dashboardSeriesKey(SPACE_ID, 12));
    await new QueryClient().fetchQuery(options);
    expect(new URL(fetch.mock.calls[0]![0].url).searchParams.get("months")).toBe("12");
  });
});

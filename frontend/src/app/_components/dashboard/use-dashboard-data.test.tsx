import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DASHBOARD_SCENARIOS } from "./dashboard-fixtures";
import {
  scriptedDashboardApi,
  type DashboardCallKind,
  type DashboardFault,
} from "./scripted-dashboard-api";
import { useDashboardData } from "./use-dashboard-data";

// The four queries of the Inicio (FE-24, KAN-84) as the cards read them: which ones a width asks for,
// that the accounts come told apart from the archived ones, and what "failed" means.
const mocks = vi.hoisted(() => ({ desktop: true }));

vi.mock("@/components/use-is-desktop", () => ({
  DESKTOP_MEDIA_QUERY: "(min-width: 64rem)",
  useIsDesktop: () => mocks.desktop,
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);
beforeEach(() => {
  mocks.desktop = true;
});

const SPACE_ID = "00000000-0000-4000-8000-000000000000";

function setup(faults: Partial<Record<DashboardCallKind, DashboardFault>> = {}) {
  const current = { ...faults };
  const scenario = DASHBOARD_SCENARIOS.canvas;
  const api = scriptedDashboardApi({
    scenario: () => scenario,
    fault: (call) => current[call.kind],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useDashboardData(api, SPACE_ID), { wrapper });
  return { ...view, api, client, faults: current };
}

const kinds = (api: { calls: Array<{ kind: DashboardCallKind }> }) => api.calls.map((c) => c.kind);

describe("useDashboardData", () => {
  it("asks for the four things from 1024 px", async () => {
    const { result, api } = setup();
    await waitFor(() => {
      expect(result.current.dashboard.data).toBeDefined();
      expect(result.current.series.data).toBeDefined();
      expect(result.current.recent.data).toBeDefined();
      expect(result.current.accounts.data).toBeDefined();
    });
    expect(new Set(kinds(api))).toEqual(new Set(["dashboard", "series", "recent", "accounts"]));
  });

  it("asks only for the dashboard and the accounts below 1024 px: there is no chart and no table", async () => {
    mocks.desktop = false;
    const { result, api } = setup();
    await waitFor(() => {
      expect(result.current.dashboard.data).toBeDefined();
      expect(result.current.accounts.data).toBeDefined();
    });
    expect(kinds(api).sort()).toEqual(["accounts", "dashboard"]);
    expect(result.current.series.data).toBeUndefined();
    expect(result.current.recent.data).toBeUndefined();
    // What was not asked for is not a failure: its cards are hidden, and no error is drawn.
    expect(result.current.series.failed).toBe(false);
    expect(result.current.recent.failed).toBe(false);
  });

  it("gives the accounts without the archived ones, in the order of the API", async () => {
    const { result, client } = setup();
    await waitFor(() => expect(result.current.accounts.data).toBeDefined());
    expect(result.current.accounts.data?.every((account) => account.archived_at === null)).toBe(
      true,
    );
    // The key is the one Cuentas, Movimientos and the sheet of "Registrar" share: with the archived.
    const cached = client.getQueriesData<unknown[]>({
      queryKey: ["spaces", SPACE_ID, "accounts"],
    });
    expect(cached).toHaveLength(1);
    expect(cached[0]?.[0]).toEqual(["spaces", SPACE_ID, "accounts", { includeArchived: true }]);
  });

  it("turns an archived account of the answer into no row", async () => {
    const { result, client } = setup();
    await waitFor(() => expect(result.current.accounts.data).toBeDefined());
    const count = result.current.accounts.data?.length ?? 0;
    const key = ["spaces", SPACE_ID, "accounts", { includeArchived: true }];
    const all = client.getQueryData<Array<{ id: string; archived_at: string | null }>>(key) ?? [];
    act(() => {
      client.setQueryData(key, [
        ...all,
        { ...all[0], id: "old", name: "Vieja", archived_at: "2026-09-01T10:00:00Z" },
      ]);
    });
    // The cache has it (the key is the one with the archived ones) and the hook leaves it out.
    expect(client.getQueryData<unknown[]>(key)).toHaveLength(count + 1);
    expect(result.current.accounts.data).toHaveLength(count);
    expect(result.current.accounts.data?.some((account) => account.id === "old")).toBe(false);
  });

  it("says a query failed only when it has nothing to show", async () => {
    const { result } = setup({ dashboard: "server" });
    await waitFor(() => expect(result.current.dashboard.failed).toBe(true));
    expect(result.current.dashboard.data).toBeUndefined();
    expect(result.current.dashboard.error).toBeDefined();
    // The others are not taken down with it.
    await waitFor(() => expect(result.current.accounts.data).toBeDefined());
    expect(result.current.accounts.failed).toBe(false);
  });

  it("keeps the data on screen when a refresh fails: it is not 'failed'", async () => {
    const { result, faults } = setup();
    await waitFor(() => expect(result.current.dashboard.data).toBeDefined());
    faults.dashboard = "offline";
    await act(async () => {
      result.current.dashboard.retry();
    });
    await waitFor(() => expect(result.current.dashboard.busy).toBe(false));
    expect(result.current.dashboard.data).toBeDefined();
    expect(result.current.dashboard.failed).toBe(false);
  });

  it("retries on demand and recovers", async () => {
    const { result, faults } = setup({ series: "server" });
    await waitFor(() => expect(result.current.series.failed).toBe(true));
    faults.series = undefined;
    await act(async () => {
      result.current.series.retry();
    });
    await waitFor(() => expect(result.current.series.data).toBeDefined());
    expect(result.current.series.failed).toBe(false);
  });
});

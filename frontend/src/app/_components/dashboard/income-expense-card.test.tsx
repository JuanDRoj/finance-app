import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardSeries } from "@/lib/core/data/dashboard";
import { IncomeExpenseCard } from "./income-expense-card";
import type { Load } from "./use-dashboard-data";

// "Ingresos y gastos" (FE-24, KAN-84): the card around the grouped bars. The chart is a stand-in (it has
// its own tests): what is under test is the header, the legend and what the card does when the series
// is loading or failed.
const mocks = vi.hoisted(() => ({ chart: vi.fn() }));

vi.mock("./income-expense-chart", () => ({
  IncomeExpenseChart: (props: unknown) => {
    mocks.chart(props);
    return <div data-testid="bars-chart" />;
  },
  IncomeExpenseLegend: () => <ul aria-label="Leyenda del gráfico" />,
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);
beforeEach(() => mocks.chart.mockReset());

const UYU = { code: "UYU", exponent: 2 };

function point(month: string, income: number, expense: number) {
  return { month, income_minor: income, expense_minor: expense, net_minor: 0 };
}
const SERIES: DashboardSeries = {
  points: [
    point("2026-05", 6500000, 4120000),
    point("2026-06", 6500000, 3890000),
    point("2026-07", 7250000, 4430000),
    point("2026-08", 6500000, 3560000),
    point("2026-09", 6800000, 3980000),
    point("2026-10", 6800000, 3677000),
  ],
};

function load(data: DashboardSeries | undefined, overrides: Partial<Load<DashboardSeries>> = {}) {
  return { data, error: undefined, failed: false, busy: false, retry: vi.fn(), ...overrides };
}

function card(series: Load<DashboardSeries>) {
  render(<IncomeExpenseCard series={series} currency={UYU} />);
  return screen.getByRole("region", { name: "Ingresos y gastos" });
}

describe("IncomeExpenseCard", () => {
  it("is a desktop card with the title at 19 px, the months it covers and the legend", () => {
    const region = card(load(SERIES));
    expect(region.className).toContain("max-lg:hidden");
    const title = within(region).getByRole("heading", { level: 2, name: "Ingresos y gastos" });
    expect(title.className).toContain("text-card-title");
    expect(within(region).getByText("Últimos 6 meses · octubre en curso")).toBeTruthy();
    expect(within(region).getByRole("list", { name: "Leyenda del gráfico" })).toBeTruthy();
  });

  it("hands the chart the series and the currency of the space", () => {
    card(load(SERIES));
    expect(screen.getByTestId("bars-chart")).toBeTruthy();
    expect(mocks.chart).toHaveBeenCalledWith({ points: SERIES.points, currency: UYU });
  });

  it("keeps the legend visible while the series loads, with the chart's place held", () => {
    const region = card(load(undefined));
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(within(region).getByRole("list", { name: "Leyenda del gráfico" })).toBeTruthy();
    expect(region.querySelector("[aria-busy='true'] [data-slot='skeleton']")).not.toBeNull();
    expect(screen.queryByTestId("bars-chart")).toBeNull();
    expect(within(region).queryByText(/Últimos/)).toBeNull();
  });

  it("says it could not load them, with 'Reintentar', and draws no chart", () => {
    const retry = vi.fn();
    const region = card(load(undefined, { failed: true, retry }));
    expect(within(region).getByText("No se pudieron cargar los ingresos y gastos")).toBeTruthy();
    expect(screen.queryByTestId("bars-chart")).toBeNull();
    expect(region.getAttribute("aria-busy")).toBeNull();
    fireEvent.click(within(region).getByRole("button", { name: "Reintentar" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("names the months of a shorter series", () => {
    const region = card(load({ points: SERIES.points.slice(-3) }));
    expect(within(region).getByText("Últimos 3 meses · octubre en curso")).toBeTruthy();
  });
});

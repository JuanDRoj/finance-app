import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardRead, DashboardSeries } from "@/lib/core/data/dashboard";
import { NetCard } from "./net-card";
import type { Load } from "./use-dashboard-data";

// The Neto, the hero of the Inicio (FE-24, KAN-84), on its own. The chart is a stand-in (it has its own
// tests); what is under test is what the card decides: the two chips, the line under the figure, the
// states of the evolution and the cricket.
const mocks = vi.hoisted(() => ({ chart: vi.fn() }));

vi.mock("./net-chart", () => ({
  NetChart: (props: unknown) => {
    mocks.chart(props);
    return <div data-testid="net-chart" />;
  },
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);
beforeEach(() => mocks.chart.mockReset());

const UYU = { code: "UYU", exponent: 2 };
const NBSP = " ";
const MINUS = "−";

const DASHBOARD: DashboardRead = {
  month: "2026-10",
  available_minor: 12890000,
  card_debt_minor: 3247000,
  net_minor: 9643000,
  month_expense_minor: 3677000,
  top_expense_categories: [],
};

function point(month: string, net: number) {
  return { month, income_minor: 0, expense_minor: 0, net_minor: net };
}
const WITH_HISTORY: DashboardSeries = {
  points: [point("2026-08", 8830000), point("2026-09", 9210000), point("2026-10", 9643000)],
};
const FIRST_MONTH: DashboardSeries = {
  points: [point("2026-08", 0), point("2026-09", 0), point("2026-10", 9643000)],
};

function series(data: DashboardSeries | undefined, overrides: Partial<Load<DashboardSeries>> = {}) {
  return { data, error: undefined, failed: false, busy: false, retry: vi.fn(), ...overrides };
}

function card(dashboard: DashboardRead | undefined, load: Load<DashboardSeries>) {
  render(<NetCard dashboard={dashboard} series={load} currency={UYU} />);
  return screen.getByRole("region", { name: "Neto" });
}

describe("NetCard", () => {
  it("writes the figure and what it is, with the month as a chip that only a phone and a tablet show", () => {
    const region = card(DASHBOARD, series(WITH_HISTORY));
    const figure = within(region).getByText("$ 96.430,00");
    expect(figure.className).toContain("text-4xl");
    expect(figure.className).toContain("md:text-net");
    expect(figure.className).toContain("tracking-title");
    expect(
      within(region).getByText("Tu disponible menos la deuda de tarjetas", { exact: false }),
    ).toBeTruthy();
    const month = region.querySelector("[data-slot='net-month']") as HTMLElement;
    expect(month.textContent).toBe("Octubre");
    expect(month.className).toContain("lg:hidden");
    expect(month.className).toContain("bg-primary-soft");
  });

  it("shows the change of the month in a chip beside the figure, for a desktop only", () => {
    const region = card(DASHBOARD, series(WITH_HISTORY));
    const chip = region.querySelector("[data-slot='net-change']") as HTMLElement;
    expect(chip.textContent).toBe("+$" + NBSP + "4.330,00 este mes");
    expect(chip.className).toContain("max-lg:hidden");
    expect(chip.getAttribute("data-direction")).toBe("up");
  });

  it("paints a rise green and a fall or no change neutral", () => {
    const cases: Array<[number, string, string]> = [
      [9643000, "up", "bg-primary-soft"],
      [9000000, "down", "bg-foreground/6"],
      [9210000, "flat", "bg-foreground/6"],
    ];
    for (const [net, direction, tint] of cases) {
      cleanup();
      const region = card({ ...DASHBOARD, net_minor: net }, series(WITH_HISTORY));
      const chip = region.querySelector("[data-slot='net-change']") as HTMLElement;
      expect(chip.getAttribute("data-direction")).toBe(direction);
      expect(chip.className).toContain(tint);
    }
  });

  it("writes a fall with the typographic minus", () => {
    const region = card({ ...DASHBOARD, net_minor: 9000000 }, series(WITH_HISTORY));
    expect(region.querySelector("[data-slot='net-change']")?.textContent).toBe(
      MINUS + "$" + NBSP + "2.100,00 este mes",
    );
  });

  it("says 'últimos 3 meses' under the figure with as many months as the series has, and only for a desktop", () => {
    const region = card(DASHBOARD, series(WITH_HISTORY));
    const months = within(region).getByText(/últimos 3 meses/);
    expect(months.className).toContain("max-lg:hidden");
  });

  it("with a single month of history there is no change and no words about months", () => {
    const region = card(DASHBOARD, series(FIRST_MONTH));
    expect(region.querySelector("[data-slot='net-change']")).toBeNull();
    expect(within(region).queryByText(/últimos/)).toBeNull();
    // The chart's shell is still handed the series: it is the one that says why there is no line.
    expect(mocks.chart).toHaveBeenCalledWith({ points: FIRST_MONTH.points, currency: UYU });
  });

  it("hands the evolution the series and the currency of the space", () => {
    card(DASHBOARD, series(WITH_HISTORY));
    expect(screen.getByTestId("net-chart")).toBeTruthy();
    expect(mocks.chart).toHaveBeenCalledWith({ points: WITH_HISTORY.points, currency: UYU });
  });

  it("puts the evolution where only a desktop sees it", () => {
    const region = card(DASHBOARD, series(WITH_HISTORY));
    expect(screen.getByTestId("net-chart").parentElement?.className).toContain("max-lg:hidden");
    expect(region).toBeTruthy();
  });

  it("peeks the cricket over the card: decorative, inside it, with no pointer and only on a desktop", () => {
    const region = card(DASHBOARD, series(WITH_HISTORY));
    const peek = region.querySelector("img[src*='kanza-peek']") as HTMLElement;
    expect(peek.getAttribute("alt")).toBe("");
    for (const expected of [
      "max-lg:hidden",
      "pointer-events-none",
      "-top-1.5",
      "right-6",
      "w-24",
    ]) {
      expect(peek.className).toContain(expected);
    }
    // The text is above it, so a figure that wraps never goes under the cricket.
    const figure = within(region).getByText("$ 96.430,00");
    expect(figure.parentElement?.className).toContain("z-10");
    expect(peek.className).toContain("z-0");
  });

  it("holds a skeleton in the place of the figure while the dashboard loads, and shows no chip", () => {
    const region = card(undefined, series(undefined));
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(region.querySelector("[data-slot='skeleton']")).not.toBeNull();
    expect(region.querySelector("[data-slot='net-month']")).toBeNull();
    expect(region.querySelector("[data-slot='net-change']")).toBeNull();
  });

  it("holds the evolution's place while the series loads, with no chip of change yet", () => {
    const region = card(DASHBOARD, series(undefined));
    expect(region.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.queryByTestId("net-chart")).toBeNull();
    expect(region.querySelector("[data-slot='net-change']")).toBeNull();
    expect(within(region).getByText("$ 96.430,00")).toBeTruthy();
  });

  it("when the series fails the figure stays, the chip goes and the chart says so with 'Reintentar'", () => {
    const retry = vi.fn();
    const region = card(DASHBOARD, series(undefined, { failed: true, retry }));
    expect(within(region).getByText("$ 96.430,00")).toBeTruthy();
    expect(region.querySelector("[data-slot='net-change']")).toBeNull();
    expect(within(region).getByText("No se pudo cargar la evolución")).toBeTruthy();
    expect(screen.queryByTestId("net-chart")).toBeNull();
    fireEvent.click(within(region).getByRole("button", { name: "Reintentar" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("lets an amount past the limit of the backend wrap, and writes it as 'Más de'", () => {
    const region = card(
      { ...DASHBOARD, net_minor: Number.MAX_SAFE_INTEGER * 2 },
      series(WITH_HISTORY),
    );
    const figure = within(region).getByText(/^Más de /);
    expect(figure.className).toContain("wrap-anywhere");
    // The change needs two exact figures: with one that is not, there is no chip.
    expect(region.querySelector("[data-slot='net-change']")).toBeNull();
  });

  it("is a region named 'Neto'", () => {
    const region = card(DASHBOARD, series(WITH_HISTORY));
    expect(within(region).getByRole("heading", { level: 2, name: "Neto" })).toBeTruthy();
  });
});

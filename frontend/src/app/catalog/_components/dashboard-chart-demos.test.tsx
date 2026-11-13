import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INCOME_EXPENSE_EMPTY_TEXT,
  NET_NO_HISTORY_TEXT,
} from "@/app/_components/dashboard/chart-series";
import {
  DASHBOARD_SCENARIOS,
  SCENARIO_LIST,
  type ScenarioId,
} from "@/app/_components/dashboard/dashboard-fixtures";
import { DashboardChartsDemo } from "./dashboard-chart-demos";

// The catalog's section of the Inicio's charts: the real components in cards, with the scenarios of
// the dashboard's fixtures to choose. It fails if a scenario stops being drawable or the selectors
// stop reaching the charts.
const mocks = vi.hoisted(() => ({ desktop: true }));
vi.mock("@/components/use-is-desktop", () => ({
  DESKTOP_MEDIA_QUERY: "(min-width: 64rem)",
  useIsDesktop: () => mocks.desktop,
}));

const LOAD = { timeout: 15000 };

beforeEach(() => {
  mocks.desktop = true;
  // The "no se pudo cargar" part throws on purpose, and React logs what its boundary catches.
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function choose(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("DashboardChartsDemo", () => {
  it("draws the two charts of the canvas, each in its card, with the legend in the header", async () => {
    render(<DashboardChartsDemo />);
    expect(
      await screen.findByRole("application", { name: /^Neto de los últimos 6 meses/ }, LOAD),
    ).toBeTruthy();
    expect(
      await screen.findByRole(
        "application",
        { name: /^Ingresos y gastos de los últimos 6 meses/ },
        LOAD,
      ),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ingresos y gastos", level: 4 })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Leyenda del gráfico" })).toBeTruthy();
    // The Neto card says what the canvas says around the chart. `getByText` turns a no-break space
    // into a normal one, so these two are written with it.
    expect(screen.getByText("+$ 4.330,00 este mes")).toBeTruthy();
    expect(screen.getAllByText("$ 96.430,00").length).toBeGreaterThan(0);
  });

  it("changes the data of both charts with the selector, one scenario after another", async () => {
    render(<DashboardChartsDemo />);
    await screen.findByRole("application", { name: /^Neto de los últimos 6 meses/ }, LOAD);

    choose("Qué datos hay", "one-month");
    expect(screen.getByText(NET_NO_HISTORY_TEXT)).toBeTruthy();
    expect(screen.queryByText(INCOME_EXPENSE_EMPTY_TEXT)).toBeNull();
    expect(
      await screen.findByRole(
        "application",
        { name: /^Ingresos y gastos de los últimos 6 meses/ },
        LOAD,
      ),
    ).toBeTruthy();

    choose("Qué datos hay", "no-movements");
    expect(screen.getByText(NET_NO_HISTORY_TEXT)).toBeTruthy();
    expect(screen.getByText(INCOME_EXPENSE_EMPTY_TEXT)).toBeTruthy();
    expect(screen.queryByRole("application")).toBeNull();

    choose("Qué datos hay", "negative-net");
    const net = await screen.findByRole(
      "application",
      { name: /^Neto de los últimos 6 meses/ },
      LOAD,
    );
    expect(net.getAttribute("aria-label")).toContain("\u2212$\u00A03.500,00 en octubre");
  });

  it("offers every scenario of the fixtures, and each one draws without throwing", async () => {
    render(<DashboardChartsDemo />);
    const select = screen.getByLabelText("Qué datos hay") as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(
      SCENARIO_LIST.map((scenario) => scenario.id),
    );
    for (const scenario of SCENARIO_LIST) {
      choose("Qué datos hay", scenario.id);
      // Each card either draws its chart or says why not: the section never goes blank.
      await waitFor(() => {
        const drawn = screen.queryAllByRole("application").length;
        const said = [NET_NO_HISTORY_TEXT, INCOME_EXPENSE_EMPTY_TEXT].filter((text) =>
          screen.queryByText(text),
        ).length;
        expect(drawn + said, scenario.id).toBe(2);
      }, LOAD);
    }
  }, 60000);

  it("writes an amount past the limit as 'Más de …' in the card and in the data", async () => {
    render(<DashboardChartsDemo initial={"beyond-the-limit" satisfies ScenarioId} />);
    await screen.findByRole("application", { name: /^Neto de los últimos 6 meses/ }, LOAD);
    expect(screen.getAllByText("Más de $ 90.071.992.547.409,91").length).toBeGreaterThan(0);
    expect(DASHBOARD_SCENARIOS["beyond-the-limit"].series.at(-1)?.income_minor).toBeGreaterThan(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("sets the width of the card from the selector", () => {
    const { container } = render(<DashboardChartsDemo />);
    const cards = () => [...container.querySelectorAll<HTMLElement>('[data-slot="card"]')];
    expect(cards().map((card) => card.style.width)).toEqual(["744px", "744px"]);
    choose("Ancho de la tarjeta", "free");
    expect(cards().map((card) => card.style.width)).toEqual(["", ""]);
    choose("Ancho de la tarjeta", "w640");
    expect(cards().map((card) => card.style.width)).toEqual(["640px", "640px"]);
  });

  it("shows the loading placeholder, and what the card says when the chart cannot load, only after asking for it", () => {
    render(<DashboardChartsDemo />);
    expect(document.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThanOrEqual(2);
    // Not from the start: what the server throws while rendering is not caught by a boundary.
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Hacer que el gráfico falle" }));
    expect(screen.getByRole("alert").textContent).toBe(
      "No se pudo cargar el gráfico. Recarga la página.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Restablecer el gráfico" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("El gráfico se dibuja con normalidad.")).toBeTruthy();
  });

  it("lists the six months of the scenario for comparing by eye", () => {
    render(<DashboardChartsDemo />);
    const details = screen.getByText("Ver los 6 meses").closest("details");
    expect(details).not.toBeNull();
    const rows = within(details as HTMLElement).getAllByRole("row");
    expect(rows).toHaveLength(7);
    expect(rows[6]?.textContent).toBe("2026-10$\u00A068.000,00$\u00A036.770,00$\u00A096.430,00");
  });

  it("tells that the charts exist from 1024 px and leaves the cards out below it (with CSS)", () => {
    mocks.desktop = false;
    const { container } = render(<DashboardChartsDemo />);
    expect(screen.queryByRole("application")).toBeNull();
    for (const card of container.querySelectorAll('[data-slot="card"]')) {
      expect(card.className).toContain("max-lg:hidden");
    }
    expect(screen.getAllByText("Ensancha la ventana a 1024 px o más para verla.")).toHaveLength(2);
  });
});

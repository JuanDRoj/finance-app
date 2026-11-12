import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DASHBOARD_SCENARIOS } from "./dashboard-fixtures";
import { NET_NO_HISTORY_TEXT } from "./chart-series";
import { NetChart } from "./net-chart";

// The Neto's chart against the scenarios of the dashboard fixtures. jsdom has no layout and no
// `ResizeObserver`, so Recharts draws at its `initialDimension` (640 x 130) and the mouse does not
// reach the tooltip: the keyboard does, which is also what these tests are about. The chart's code
// loads with `next/dynamic`, so what it draws is awaited (`findBy…`, with room for the first import).
const mocks = vi.hoisted(() => ({ desktop: true }));
vi.mock("@/components/use-is-desktop", () => ({
  DESKTOP_MEDIA_QUERY: "(min-width: 64rem)",
  useIsDesktop: () => mocks.desktop,
}));

const LOAD = { timeout: 15000 };
const CANVAS = DASHBOARD_SCENARIOS.canvas;
const CANVAS_LABEL =
  "Neto de los últimos 6 meses: de $\u00A071.200,00 en mayo a $\u00A096.430,00 en octubre";

function renderChart(scenario = CANVAS) {
  return render(<NetChart points={scenario.series} currency={scenario.currency} />);
}

/** The chart's focusable surface, once its code has loaded. */
function chartOf(name: string | RegExp) {
  return screen.findByRole("application", { name }, LOAD);
}

beforeEach(() => {
  mocks.desktop = true;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("NetChart, from 1024 px", () => {
  it("draws the area with the summary as its name and says it is a chart", async () => {
    renderChart();
    const chart = await chartOf(CANVAS_LABEL);
    expect(chart.getAttribute("aria-roledescription")).toBe("gráfico");
    expect(chart.getAttribute("tabindex")).toBe("0");
  });

  it("names the months on the axis, with 'Set' for setiembre", async () => {
    const { container } = renderChart();
    await chartOf(CANVAS_LABEL);
    const labels = [...container.querySelectorAll("svg text")].map((text) => text.textContent);
    expect(labels).toEqual(["May", "Jun", "Jul", "Ago", "Set", "Oct"]);
  });

  it("puts a dot on every month, the last one (today) bigger", async () => {
    const { container } = renderChart();
    await chartOf(CANVAS_LABEL);
    const radii = [...container.querySelectorAll("svg circle")].map((dot) => dot.getAttribute("r"));
    expect(radii).toEqual(["3", "3", "3", "3", "3", "5"]);
  });

  it("draws a line and an area in the primary color and shows no Y axis", async () => {
    const { container } = renderChart();
    await chartOf(CANVAS_LABEL);
    const curve = container.querySelector("path.recharts-area-curve");
    expect(curve?.getAttribute("stroke")).toBe("var(--primary)");
    expect(curve?.getAttribute("stroke-width")).toBe("2");
    expect(container.querySelector("path.recharts-area-area")?.getAttribute("fill")).toBe(
      "var(--primary)",
    );
    expect(container.querySelector(".recharts-yAxis")).toBeNull();
    expect(container.querySelector(".recharts-cartesian-grid")).toBeNull();
  });

  it("has the whole series as a table for a screen reader", async () => {
    renderChart();
    await chartOf(CANVAS_LABEL);
    const table = screen.getByRole("table", { name: "Neto al cierre de cada mes" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(7);
    expect(rows.map((row) => row.textContent)).toEqual([
      "MesNeto",
      "Mayo$\u00A071.200,00",
      "Junio$\u00A076.900,00",
      "Julio$\u00A081.400,00",
      "Agosto$\u00A088.300,00",
      "Setiembre$\u00A092.100,00",
      "Octubre (hoy)$\u00A096.430,00",
    ]);
    expect(within(table).getByRole("rowheader", { name: "Octubre (hoy)" })).toBeTruthy();
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Mes", "Neto"]);
  });

  it("shows the month and its net in the tooltip when the keyboard focuses the chart and moves along it", async () => {
    renderChart();
    const chart = await chartOf(CANVAS_LABEL);
    expect(screen.queryByRole("status")).toBeNull();

    act(() => chart.focus());
    let tooltip = await screen.findByRole("status");
    expect(tooltip.textContent).toBe("MayoNeto$\u00A071.200,00");

    for (let step = 0; step < 5; step += 1) fireEvent.keyDown(chart, { key: "ArrowRight" });
    tooltip = await screen.findByRole("status");
    expect(tooltip.textContent).toBe("Octubre (hoy)Neto$\u00A096.430,00");
    expect(tooltip.getAttribute("aria-live")).toBe("polite");

    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect((await screen.findByRole("status")).textContent).toBe("SetiembreNeto$\u00A092.100,00");

    fireEvent.blur(chart);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("makes the dot of the month in focus the big one", async () => {
    const { container } = renderChart();
    const chart = await chartOf(CANVAS_LABEL);
    act(() => chart.focus());
    await screen.findByRole("status");
    const active = container.querySelector(
      "circle.recharts-active-dot circle, .recharts-active-dot circle",
    );
    expect(active?.getAttribute("r")).toBe("5");
    expect(active?.getAttribute("stroke")).toBe("var(--surface)");
  });

  it("writes a negative net with the minus sign in the tooltip, the table and the name", async () => {
    const scenario = DASHBOARD_SCENARIOS["negative-net"];
    renderChart(scenario);
    const chart = await chartOf(/^Neto de los últimos 6 meses: de \$\u00A012\.000,00 en mayo a/);
    expect(chart.getAttribute("aria-label")).toBe(
      "Neto de los últimos 6 meses: de $\u00A012.000,00 en mayo a \u2212$\u00A03.500,00 en octubre",
    );
    act(() => chart.focus());
    for (let step = 0; step < 2; step += 1) fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect((await screen.findByRole("status")).textContent).toBe("JulioNeto\u2212$\u00A03.800,00");
    const table = screen.getByRole("table");
    expect(within(table).getByRole("row", { name: /Octubre/ }).textContent).toBe(
      "Octubre (hoy)\u2212$\u00A03.500,00",
    );
  });

  it("does not hide an amount it cannot say exactly: 'Más de …'", async () => {
    const scenario = DASHBOARD_SCENARIOS["beyond-the-limit"];
    renderChart(scenario);
    const chart = await chartOf(/^Neto de los últimos 6 meses/);
    expect(chart.getAttribute("aria-label")).toContain("Más de $\u00A090.071.992.547.409,91");
    const table = screen.getByRole("table");
    expect(within(table).getByRole("row", { name: /Octubre/ }).textContent).toBe(
      "Octubre (hoy)Más de $\u00A090.071.992.547.409,91",
    );
  });

  it("draws the largest amounts without throwing, and the currency of the space sets the decimals", async () => {
    for (const id of ["worst-case", "at-the-limit", "exponent-0", "exponent-3"] as const) {
      const scenario = DASHBOARD_SCENARIOS[id];
      renderChart(scenario);
      await chartOf(/^Neto de los últimos 6 meses/);
      cleanup();
    }
    const clp = DASHBOARD_SCENARIOS["exponent-0"];
    renderChart(clp);
    await chartOf(/^Neto de los últimos 6 meses/);
    const table = screen.getByRole("table");
    expect(within(table).getByRole("row", { name: /Octubre/ }).textContent).toBe(
      "Octubre (hoy)CLP\u00A096.430",
    );
  });
});

describe("NetChart, Escape closes the tooltip (WCAG 2.2 1.4.13)", () => {
  /** The chart inside a parent that records the keys that reach it, like a dialog around it would. */
  function renderInside() {
    const keys: string[] = [];
    const view = render(
      <div onKeyDown={(event) => keys.push(event.key)}>
        <NetChart points={CANVAS.series} currency={CANVAS.currency} />
      </div>,
    );
    return { ...view, keys };
  }

  it("hides the tooltip without moving the focus, and an arrow shows the next month's again", async () => {
    renderChart();
    const chart = await chartOf(CANVAS_LABEL);
    act(() => chart.focus());
    expect((await screen.findByRole("status")).textContent).toBe("MayoNeto$\u00A071.200,00");

    fireEvent.keyDown(chart, { key: "Escape" });
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.activeElement).toBe(chart);

    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect((await screen.findByRole("status")).textContent).toBe("JunioNeto$\u00A076.900,00");

    // It can be closed again, and the arrow that comes back goes the other way.
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect((await screen.findByRole("status")).textContent).toBe("MayoNeto$\u00A071.200,00");
  });

  it("shows it again with a mouse move over the chart, and Escape does not leave it stuck after leaving the chart", async () => {
    const { container } = renderChart();
    const chart = await chartOf(CANVAS_LABEL);
    act(() => chart.focus());
    await screen.findByRole("status");

    fireEvent.keyDown(chart, { key: "Escape" });
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.mouseMove(container.querySelector('[data-slot="chart"]') as HTMLElement);
    expect(await screen.findByRole("status")).toBeTruthy();

    fireEvent.keyDown(chart, { key: "Escape" });
    expect(screen.queryByRole("status")).toBeNull();
    // Leaving the chart and coming back: Recharts shows nothing until an arrow, and the arrow does.
    act(() => chart.blur());
    act(() => chart.focus());
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(await screen.findByRole("status")).toBeTruthy();
  });

  it("swallows the Escape that closes the tooltip, so a dialog around the chart stays open", async () => {
    const { keys } = renderInside();
    const chart = await chartOf(CANVAS_LABEL);
    act(() => chart.focus());
    await screen.findByRole("status");

    fireEvent.keyDown(chart, { key: "Escape" });
    expect(screen.queryByRole("status")).toBeNull();
    expect(keys).toEqual([]);

    // With no tooltip left to close, Escape goes on its way: the dialog may close with it.
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(keys).toEqual(["Escape"]);
  });

  it("also closes a tooltip that is showing while the focus is elsewhere: Escape on the page", async () => {
    const { container } = renderChart();
    const chart = await chartOf(CANVAS_LABEL);
    act(() => chart.focus());
    await screen.findByRole("status");

    // The key does not go through the chart: only the listeners of the document hear it. Recharts'
    // own only hides the box of its tooltip; ours takes the card out (and the column behind it).
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector('[data-slot="chart-tooltip"]')).toBeNull();
    expect(document.activeElement).toBe(chart);

    // And it comes back with an arrow, as after any other Escape.
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(await screen.findByRole("status")).toBeTruthy();
  });

  it("does not close it twice when the focus is in the chart, and leaves the page its Escape when there is no tooltip", async () => {
    const onDocument = vi.fn();
    document.addEventListener("keydown", onDocument);
    try {
      renderChart();
      const chart = await chartOf(CANVAS_LABEL);
      act(() => chart.focus());
      await screen.findByRole("status");

      // Closed by the chart, which swallows the key: the document never hears it.
      fireEvent.keyDown(chart, { key: "Escape" });
      expect(screen.queryByRole("status")).toBeNull();
      expect(onDocument).not.toHaveBeenCalled();

      // Nothing left to close: the key goes on to the page and the tooltip stays hidden.
      fireEvent.keyDown(chart, { key: "Escape" });
      expect(onDocument).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("status")).toBeNull();
    } finally {
      document.removeEventListener("keydown", onDocument);
    }
  });

  it("stops hearing the page once the chart is gone, and a later Escape does nothing", async () => {
    // How many listeners there are is checked on the hook alone (`use-dismissible-tooltip.test.tsx`):
    // Recharts adds and removes its own `keydown` listeners on the document as the tooltip moves.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderChart();
    const chart = await chartOf(CANVAS_LABEL);
    act(() => chart.focus());
    await screen.findByRole("status");

    unmount();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(logged).not.toHaveBeenCalled();
    expect(document.querySelector('[data-slot="chart-tooltip"]')).toBeNull();
  });

  it("lets Escape through when the chart shows no tooltip, and leaves Tab and the arrows alone", async () => {
    const { keys } = renderInside();
    const chart = await chartOf(CANVAS_LABEL);
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(keys).toEqual(["Escape"]);

    act(() => chart.focus());
    await screen.findByRole("status");
    // Not prevented (the browser moves the focus out of the chart) and it reaches the parent.
    expect(fireEvent.keyDown(chart, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(chart, { key: "ArrowRight" })).toBe(true);
    expect(keys).toEqual(["Escape", "Tab", "ArrowRight"]);
    expect(screen.getByRole("status")).toBeTruthy();
  });
});

describe("NetChart, with little history", () => {
  it.each(["one-month", "no-movements"] as const)(
    "says there is nothing to draw yet in %s instead of drawing a line from 0",
    async (id) => {
      const scenario = DASHBOARD_SCENARIOS[id];
      const { container } = renderChart(scenario);
      expect(screen.getByText(NET_NO_HISTORY_TEXT)).toBeTruthy();
      expect(container.querySelector("svg")).toBeNull();
      expect(screen.queryByRole("application")).toBeNull();
      expect(screen.queryByRole("table")).toBeNull();
    },
  );

  it("shows that text only from 1024 px (the card has no chart below it)", () => {
    renderChart(DASHBOARD_SCENARIOS["one-month"]);
    expect(screen.getByText(NET_NO_HISTORY_TEXT).className).toContain("max-lg:hidden");
  });
});

describe("NetChart, below 1024 px", () => {
  it("holds the place of the chart with CSS and draws nothing: Recharts is not even asked for", () => {
    mocks.desktop = false;
    const { container } = renderChart();
    const frame = container.querySelector('[data-slot="net-chart"]');
    expect(frame?.className).toContain("max-lg:hidden");
    expect(frame?.className).toContain("h-[130px]");
    expect(frame?.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.queryByRole("application")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("draws once the window gets wide enough", async () => {
    mocks.desktop = false;
    const { rerender } = renderChart();
    expect(screen.queryByRole("application")).toBeNull();
    mocks.desktop = true;
    rerender(<NetChart points={CANVAS.series} currency={CANVAS.currency} />);
    expect(await chartOf(CANVAS_LABEL)).toBeTruthy();
  });
});

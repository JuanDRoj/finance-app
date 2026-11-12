import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DASHBOARD_SCENARIOS } from "./dashboard-fixtures";
import { INCOME_EXPENSE_EMPTY_TEXT } from "./chart-series";
import { IncomeExpenseChart, IncomeExpenseLegend } from "./income-expense-chart";

// The bars of Ingresos y gastos against the scenarios of the dashboard fixtures (see
// `net-chart.test.tsx` for how jsdom and the lazy code are handled).
const mocks = vi.hoisted(() => ({ desktop: true }));
vi.mock("@/components/use-is-desktop", () => ({
  DESKTOP_MEDIA_QUERY: "(min-width: 64rem)",
  useIsDesktop: () => mocks.desktop,
}));

const LOAD = { timeout: 15000 };
const CANVAS = DASHBOARD_SCENARIOS.canvas;
const CANVAS_LABEL =
  "Ingresos y gastos de los últimos 6 meses. En octubre (mes en curso): " +
  "ingresos $\u00A068.000,00, gastos $\u00A036.770,00";

function renderChart(scenario = CANVAS) {
  return render(<IncomeExpenseChart points={scenario.series} currency={scenario.currency} />);
}

/** The labels of an axis, in order. */
function tickLabels(container: HTMLElement, axis: "xAxis" | "yAxis") {
  return [
    ...container.querySelectorAll(
      `.recharts-${axis}-tick-labels .recharts-cartesian-axis-tick-value`,
    ),
  ].map((text) => text.textContent);
}

function chartOf(name: string | RegExp) {
  return screen.findByRole("application", { name }, LOAD);
}

/**
 * jsdom has no layout, so Recharts cannot tell which month is under the pointer: the wrapper gets a
 * size and a position, and the returned function moves the pointer to `x` (Recharts reads the
 * position on the next animation frame, hence the wait).
 */
function hoverable(container: HTMLElement, height: number) {
  const wrapper = container.querySelector(".recharts-wrapper") as HTMLElement;
  Object.defineProperty(wrapper, "offsetWidth", { value: 640, configurable: true });
  Object.defineProperty(wrapper, "offsetHeight", { value: height, configurable: true });
  wrapper.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 640, height, right: 640, bottom: height, x: 0, y: 0 }) as DOMRect;
  return async (x: number) => {
    fireEvent.mouseMove(wrapper, { clientX: x, clientY: height / 2 });
    await new Promise((resolve) => setTimeout(resolve, 60));
  };
}

beforeEach(() => {
  mocks.desktop = true;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("IncomeExpenseChart, from 1024 px", () => {
  it("draws the bars with the summary of the current month as its name", async () => {
    renderChart();
    const chart = await chartOf(CANVAS_LABEL);
    expect(chart.getAttribute("aria-roledescription")).toBe("gráfico");
    expect(chart.getAttribute("tabindex")).toBe("0");
  });

  it("draws two bars for each of the six months, income in one color and expense in the other", async () => {
    const { container } = renderChart();
    await chartOf(CANVAS_LABEL);
    const fills = [...container.querySelectorAll(".recharts-bar")].map((bar) =>
      [...bar.querySelectorAll("path.recharts-rectangle")].map((rect) => rect.getAttribute("fill")),
    );
    expect(fills).toEqual([
      Array(6).fill("var(--chart-income)"),
      Array(6).fill("var(--chart-expense)"),
    ]);
    // 22 px each.
    const widths = new Set(
      [...container.querySelectorAll("path.recharts-rectangle")].map((rect) =>
        rect.getAttribute("width"),
      ),
    );
    expect([...widths]).toEqual(["22"]);
  });

  it("labels the months and the axis 'in words': 0, 25 mil, 50 mil, 75 mil", async () => {
    const { container } = renderChart();
    await chartOf(CANVAS_LABEL);
    expect(tickLabels(container, "xAxis")).toEqual(["May", "Jun", "Jul", "Ago", "Set", "Oct"]);
    expect(tickLabels(container, "yAxis")).toEqual(["0", "25 mil", "50 mil", "75 mil"]);
  });

  it("sizes the labels with the tokens' classes: 13 px for the months, 12 px for the amounts", async () => {
    const { container } = renderChart();
    await chartOf(CANVAS_LABEL);
    const classOf = (axis: "xAxis" | "yAxis") =>
      container
        .querySelector(`.recharts-${axis}-tick-labels .recharts-cartesian-axis-tick-value`)
        ?.getAttribute("class");
    expect(classOf("xAxis")).toContain("text-caption");
    expect(classOf("yAxis")).toContain("text-xs");
    expect(container.querySelector("svg text[font-size]")).toBeNull();
  });

  it("draws one horizontal grid line for each tick and no vertical ones", async () => {
    const { container } = renderChart();
    await chartOf(CANVAS_LABEL);
    const lines = [...container.querySelectorAll(".recharts-cartesian-grid line")];
    expect(lines).toHaveLength(4);
    expect(lines.every((line) => line.getAttribute("stroke") === "var(--border)")).toBe(true);
    expect(lines.every((line) => line.getAttribute("y1") === line.getAttribute("y2"))).toBe(true);
  });

  it("widens the axis only when its labels need it", async () => {
    const plotLeft = (container: HTMLElement) =>
      Number(container.querySelector(".recharts-cartesian-grid line")?.getAttribute("x1"));
    const normal = renderChart();
    await chartOf(CANVAS_LABEL);
    const normalLeft = plotLeft(normal.container);
    expect(normalLeft).toBeLessThanOrEqual(56);
    cleanup();

    const wide = renderChart(DASHBOARD_SCENARIOS["worst-case"]);
    await chartOf(/^Ingresos y gastos de los últimos 6 meses/);
    expect(plotLeft(wide.container)).toBeGreaterThan(normalLeft);
  });

  it("has the legend of the colors in the card's header and the table of the figures for a screen reader", async () => {
    renderChart();
    await chartOf(CANVAS_LABEL);
    const table = screen.getByRole("table", { name: "Ingresos, gastos y ahorro de cada mes" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Mes", "Ingresos", "Gastos", "Ahorro"]);
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(7);
    expect(rows[1]?.textContent).toBe("Mayo$\u00A065.000,00$\u00A041.200,00$\u00A023.800,00");
    expect(rows[6]?.textContent).toBe(
      "Octubre (en curso)$\u00A068.000,00$\u00A036.770,00$\u00A031.230,00",
    );
  });

  it("shows income, expense and, below, the savings of the month the keyboard is on", async () => {
    renderChart();
    const chart = await chartOf(CANVAS_LABEL);
    expect(screen.queryByRole("status")).toBeNull();

    act(() => chart.focus());
    let tooltip = await screen.findByRole("status");
    expect(tooltip.textContent).toBe(
      "MayoIngresos$\u00A065.000,00Gastos$\u00A041.200,00Ahorro$\u00A023.800,00",
    );
    expect(tooltip.getAttribute("aria-live")).toBe("polite");
    expect(tooltip.className).toContain("rounded-chart-tooltip");
    // The savings are the last row, apart from the other two by a rule.
    const rows = [...tooltip.querySelectorAll(":scope > div")];
    expect(rows.map((row) => row.className.includes("border-t"))).toEqual([false, false, true]);

    for (let step = 0; step < 5; step += 1) fireEvent.keyDown(chart, { key: "ArrowRight" });
    tooltip = await screen.findByRole("status");
    expect(tooltip.textContent).toBe(
      "Octubre (en curso)Ingresos$\u00A068.000,00Gastos$\u00A036.770,00Ahorro$\u00A031.230,00",
    );

    fireEvent.blur(chart);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("highlights the column of that month with the tint of a hovered row", async () => {
    const { container } = renderChart();
    const chart = await chartOf(CANVAS_LABEL);
    act(() => chart.focus());
    await screen.findByRole("status");
    const column = container.querySelector("path.fill-primary\\/10");
    expect(column?.getAttribute("class")).toBe("fill-primary/10 dark:fill-primary/12");
  });

  it("writes savings below zero with the minus sign", async () => {
    renderChart(DASHBOARD_SCENARIOS["negative-net"]);
    const chart = await chartOf(/^Ingresos y gastos de los últimos 6 meses/);
    act(() => chart.focus());
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    // The second month (june) is 65.000,00 in and 58.900,00 out: 6.100,00 left; october is 38.000,00 in and 36.770,00 out.
    expect((await screen.findByRole("status")).textContent).toBe(
      "JunioIngresos$\u00A065.000,00Gastos$\u00A058.900,00Ahorro$\u00A06.100,00",
    );
    for (let step = 0; step < 1; step += 1) fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect((await screen.findByRole("status")).textContent).toBe(
      "JulioIngresos$\u00A032.500,00Gastos$\u00A044.300,00Ahorro\u2212$\u00A011.800,00",
    );
  });

  it("does not claim an exact amount it cannot: 'Más de …', and no savings figure", async () => {
    renderChart(DASHBOARD_SCENARIOS["beyond-the-limit"]);
    const chart = await chartOf(/^Ingresos y gastos de los últimos 6 meses/);
    act(() => chart.focus());
    for (let step = 0; step < 5; step += 1) fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect((await screen.findByRole("status")).textContent).toBe(
      "Octubre (en curso)" +
        "IngresosMás de $\u00A090.071.992.547.409,91" +
        "GastosMás de $\u00A090.071.992.547.409,91" +
        "Ahorro—",
    );
  });

  it("draws every scenario, the largest amounts and the other currencies, without throwing", async () => {
    for (const id of [
      "worst-case",
      "at-the-limit",
      "no-expenses",
      "exponent-0",
      "exponent-3",
    ] as const) {
      const scenario = DASHBOARD_SCENARIOS[id];
      renderChart(scenario);
      await chartOf(/^Ingresos y gastos de los últimos 6 meses/);
      cleanup();
    }
    const clp = DASHBOARD_SCENARIOS["exponent-0"];
    const { container } = renderChart(clp);
    await chartOf(/^Ingresos y gastos de los últimos 6 meses/);
    expect(tickLabels(container, "yAxis")).toEqual(["0", "25 mil", "50 mil", "75 mil"]);
    expect(within(screen.getByRole("table")).getAllByRole("row")[6]?.textContent).toBe(
      "Octubre (en curso)CLP\u00A068.000CLP\u00A036.770CLP\u00A031.230",
    );
  });
});

describe("IncomeExpenseChart, Escape closes the tooltip (WCAG 2.2 1.4.13)", () => {
  const COLUMN = "path.fill-primary\\/10";

  function renderInside() {
    const keys: string[] = [];
    const view = render(
      <div onKeyDown={(event) => keys.push(event.key)}>
        <IncomeExpenseChart points={CANVAS.series} currency={CANVAS.currency} />
      </div>,
    );
    return { ...view, keys };
  }

  it("hides the tooltip and the highlighted column without moving the focus, and an arrow brings back the next month's", async () => {
    const { container } = renderChart();
    const chart = await chartOf(CANVAS_LABEL);
    act(() => chart.focus());
    expect((await screen.findByRole("status")).textContent).toBe(
      "MayoIngresos$\u00A065.000,00Gastos$\u00A041.200,00Ahorro$\u00A023.800,00",
    );
    expect(container.querySelector(COLUMN)).not.toBeNull();

    fireEvent.keyDown(chart, { key: "Escape" });
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector(COLUMN)).toBeNull();
    expect(document.activeElement).toBe(chart);

    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect((await screen.findByRole("status")).textContent).toBe(
      "JunioIngresos$\u00A065.000,00Gastos$\u00A038.900,00Ahorro$\u00A026.100,00",
    );
    expect(container.querySelector(COLUMN)).not.toBeNull();

    fireEvent.keyDown(chart, { key: "Escape" });
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect((await screen.findByRole("status")).textContent).toContain("Mayo");
  });

  it("brings back a tooltip closed with Escape only on another month: not with a tremor in the same column", async () => {
    const { container } = renderChart();
    await chartOf(CANVAS_LABEL);
    const hover = hoverable(container, 220);
    const closed = () => container.querySelector('[data-slot="chart-tooltip"]') === null;

    await hover(200);
    expect((await screen.findByRole("status")).textContent).toContain("Junio");

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(closed()).toBe(true);

    // The pointer moves, but stays on June: nothing comes back (neither the card nor the highlight).
    await hover(204);
    await hover(200);
    expect(closed()).toBe(true);

    // On another month it does.
    await hover(396);
    expect((await screen.findByRole("status")).textContent).toContain("Agosto");
  });

  it("brings it back on the same month once the pointer has left the chart and come in again", async () => {
    const { container } = renderChart();
    await chartOf(CANVAS_LABEL);
    const hover = hoverable(container, 220);

    await hover(200);
    await screen.findByRole("status");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(container.querySelector('[data-slot="chart-tooltip"]')).toBeNull();

    // Leaving alone shows nothing.
    fireEvent.mouseLeave(container.querySelector('[data-slot="chart"]') as HTMLElement);
    expect(container.querySelector('[data-slot="chart-tooltip"]')).toBeNull();

    await hover(200);
    expect((await screen.findByRole("status")).textContent).toContain("Junio");
  });

  it("shows the same month again with an arrow at the first month, where the arrow cannot move", async () => {
    renderChart();
    const chart = await chartOf(CANVAS_LABEL);
    act(() => chart.focus());
    expect((await screen.findByRole("status")).textContent).toContain("Mayo");

    fireEvent.keyDown(chart, { key: "Escape" });
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect((await screen.findByRole("status")).textContent).toContain("Mayo");
  });

  it("does not leave the tooltip stuck after leaving the chart: an arrow shows it again", async () => {
    renderChart();
    const chart = await chartOf(CANVAS_LABEL);
    act(() => chart.focus());
    await screen.findByRole("status");

    fireEvent.keyDown(chart, { key: "Escape" });
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
    expect(container.querySelector(COLUMN)).toBeNull();
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

  it("leaves no keydown listener on the page once the chart is gone", async () => {
    // Which listener is the hook's cannot be told apart from the ones Recharts adds and removes as
    // its tooltip moves, so every `keydown` listener that was added (by exact reference) must have
    // been removed. The hook's own add and remove, one by one, are in `use-dismissible-tooltip.test.tsx`.
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const keydownListeners = (spy: typeof add) =>
      spy.mock.calls.filter(([type]) => type === "keydown").map(([, listener]) => listener);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = renderChart();
    const chart = await chartOf(CANVAS_LABEL);
    act(() => chart.focus());
    await screen.findByRole("status");
    expect(keydownListeners(add).length).toBeGreaterThan(0);

    unmount();
    const removed = new Set(keydownListeners(remove));
    expect(keydownListeners(add).filter((listener) => !removed.has(listener))).toEqual([]);

    // And an Escape now has nobody to reach.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(logged).not.toHaveBeenCalled();
  });

  it("lets Escape through when the chart shows no tooltip, and leaves Tab and the arrows alone", async () => {
    const { keys } = renderInside();
    const chart = await chartOf(CANVAS_LABEL);
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(keys).toEqual(["Escape"]);

    act(() => chart.focus());
    await screen.findByRole("status");
    expect(fireEvent.keyDown(chart, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(chart, { key: "ArrowRight" })).toBe(true);
    expect(keys).toEqual(["Escape", "Tab", "ArrowRight"]);
    expect(screen.getByRole("status")).toBeTruthy();
  });
});

describe("IncomeExpenseChart, with little or nothing to draw", () => {
  it("draws the six months when only the last one has something: the other five are empty", async () => {
    const { container } = renderChart(DASHBOARD_SCENARIOS["one-month"]);
    await chartOf(/^Ingresos y gastos de los últimos 6 meses/);
    expect(tickLabels(container, "xAxis")).toEqual(["May", "Jun", "Jul", "Ago", "Set", "Oct"]);
    // Only October has bars (a month of 0 draws none), and the table still lists the six.
    expect(container.querySelectorAll("path.recharts-rectangle")).toHaveLength(2);
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(7);
    expect(screen.queryByText(INCOME_EXPENSE_EMPTY_TEXT)).toBeNull();
  });

  it("says there is nothing to draw when no month has income or expenses, from 1024 px only", () => {
    const { container } = renderChart(DASHBOARD_SCENARIOS["no-movements"]);
    const text = screen.getByText(INCOME_EXPENSE_EMPTY_TEXT);
    expect(text.className).toContain("max-lg:hidden");
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.queryByRole("application")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("IncomeExpenseChart, below 1024 px", () => {
  it("holds the place of the chart with CSS and draws nothing", () => {
    mocks.desktop = false;
    const { container } = renderChart();
    const frame = container.querySelector('[data-slot="income-expense-chart"]');
    expect(frame?.className).toContain("max-lg:hidden");
    expect(frame?.className).toContain("h-[220px]");
    expect(frame?.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.queryByRole("application")).toBeNull();
  });
});

describe("IncomeExpenseLegend", () => {
  it("names the two series and does not depend on Recharts", () => {
    render(<IncomeExpenseLegend />);
    const legend = screen.getByRole("list", { name: "Leyenda del gráfico" });
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Ingresos", "Gastos"]);
    const squares = legend.querySelectorAll("li > span[aria-hidden]");
    expect([...squares].map((square) => square.className)).toEqual([
      expect.stringContaining("bg-chart-income"),
      expect.stringContaining("bg-chart-expense"),
    ]);
    expect([...squares].every((square) => square.className.includes("size-2.5"))).toBe(true);
    expect([...squares].every((square) => square.className.includes("rounded-swatch"))).toBe(true);
  });
});

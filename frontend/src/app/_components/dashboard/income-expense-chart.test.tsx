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

beforeEach(() => {
  mocks.desktop = true;
});
afterEach(cleanup);

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

"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import {
  describeChartMonth,
  describeIncomeExpenseChartLabel,
  describeMonthSavings,
  formatCompactMoney,
  formatDashboardAmount,
  formatMonthShort,
  incomeExpenseTicks,
} from "@/lib/core/dashboard";
import { ChartDataTable } from "./chart-data-table";
import { ChartTooltipCard, ChartTooltipRow } from "./chart-tooltip-card";
import { useDismissibleTooltip } from "./use-dismissible-tooltip";
import {
  CHART_HEIGHT_CLASS,
  CHART_HEIGHT_PX,
  SERIES_LABELS,
  type SeriesChartProps,
} from "./chart-series";

// The grouped bars of Ingresos y gastos (FE-36, KAN-102; docs/diseno.md D9; K-V2-Escritorio): a group
// per month, income and expense side by side (22 px each, 2 px between them, radius 4 4 0 0), one
// Y axis from 0 with 4 ticks in words ("25 mil"), a 1 px grid, and a tooltip of 190 px with the two
// figures and, below a rule, the savings. The color follows the series, never the order
// (`chart-income`, `chart-expense`). This is the part that loads Recharts (see `income-expense-chart.tsx`).

const BAR_WIDTH = 22;
const BAR_GAP = 2;

/**
 * The width of the Y axis: the canvas' 52 px, wider only when its labels are ("1,5 millones" for a
 * month of 15 million). Worked out from the number of characters (about 7 px each at 12 px) instead
 * of measured by Recharts (`width="auto"`), so it is the same on every browser and in a test.
 */
const Y_AXIS_MIN_WIDTH = 52;
const Y_LABEL_CHAR_WIDTH = 7;
const Y_LABEL_PADDING = 12;

function yAxisWidthFor(labels: Iterable<string>): number {
  let longest = 0;
  for (const label of labels) longest = Math.max(longest, label.length);
  return Math.max(Y_AXIS_MIN_WIDTH, longest * Y_LABEL_CHAR_WIDTH + Y_LABEL_PADDING);
}

/**
 * The labels of the axes, in `muted-foreground`; the months are 13 px (`text-caption`) and the
 * amounts 12 px (`text-xs`), the sizes as classes of the tokens, like the Neto's months.
 */
const MONTH_TICK = { fill: "var(--muted-foreground)", className: "text-caption" } as const;
const AMOUNT_TICK = { fill: "var(--muted-foreground)", className: "text-xs" } as const;

/** The column under the mouse or the keyboard: `primary` at 10 % (12 % in dark), round at the top. */
const COLUMN_RADIUS = 12;

type ColumnCursorProps = { x?: number; y?: number; width?: number; height?: number };

function ColumnCursor({ x = 0, y = 0, width = 0, height = 0 }: ColumnCursorProps) {
  const radius = Math.min(COLUMN_RADIUS, width / 2, height);
  const path =
    `M${x},${y + height}V${y + radius}A${radius},${radius} 0 0 1 ${x + radius},${y}` +
    `H${x + width - radius}A${radius},${radius} 0 0 1 ${x + width},${y + radius}V${y + height}Z`;
  return <path d={path} className="fill-primary/10 dark:fill-primary/12" />;
}

type BarsRow = {
  month: string;
  /** The label of the axis: "Oct". */
  label: string;
  /** The tooltip's title: "Octubre (en curso)". */
  title: string;
  /** What is drawn: never below 0, whatever arrives. */
  income: number;
  expense: number;
  incomeText: string;
  expenseText: string;
  savingsText: string;
};

function buildRows(points: SeriesChartProps["points"], currency: SeriesChartProps["currency"]) {
  return points.map((point, index): BarsRow => ({
    month: point.month,
    label: formatMonthShort(point.month),
    title: describeChartMonth(point.month, index === points.length - 1 ? "en curso" : undefined),
    income: Math.max(0, point.income_minor),
    expense: Math.max(0, point.expense_minor),
    incomeText: formatDashboardAmount(point.income_minor, currency),
    expenseText: formatDashboardAmount(point.expense_minor, currency),
    savingsText: describeMonthSavings(point, currency),
  }));
}

/** Recharts hands its own props to the element given as `content`; `onShownChange` is ours. */
type BarsTooltipProps = Partial<TooltipContentProps> & {
  onShownChange: (index: string | null) => void;
};

function BarsTooltip({ active, payload, activeIndex, onShownChange }: BarsTooltipProps) {
  const row = payload?.[0]?.payload as BarsRow | undefined;
  if (!active || !row) return null;
  return (
    <ChartTooltipCard
      title={row.title}
      className="w-[190px]"
      shownAt={activeIndex}
      onShownChange={onShownChange}
    >
      <ChartTooltipRow label={SERIES_LABELS.income} value={row.incomeText} />
      <ChartTooltipRow label={SERIES_LABELS.expense} value={row.expenseText} />
      <ChartTooltipRow label={SERIES_LABELS.savings} value={row.savingsText} separated />
    </ChartTooltipCard>
  );
}

export function IncomeExpenseChartBody({ points, currency }: Readonly<SeriesChartProps>) {
  const rows = useMemo(() => buildRows(points, currency), [points, currency]);
  const { active, resetKey, containerProps, chartProps, onShownChange } = useDismissibleTooltip();
  const axis = useMemo(() => {
    const ticks = incomeExpenseTicks(points);
    const labels = new Map(ticks.map((tick) => [Number(tick), formatCompactMoney(tick, currency)]));
    return {
      width: yAxisWidthFor(labels.values()),
      ticks: ticks.map(Number),
      top: Number(ticks[ticks.length - 1]),
      format: (value: number) =>
        labels.get(value) ?? formatCompactMoney(BigInt(Math.round(value)), currency),
    };
  }, [points, currency]);

  return (
    <>
      <ChartContainer
        {...containerProps}
        className={CHART_HEIGHT_CLASS.bars}
        initialDimension={{ width: 640, height: CHART_HEIGHT_PX.bars }}
      >
        <BarChart
          {...chartProps}
          data={rows}
          accessibilityLayer
          aria-label={describeIncomeExpenseChartLabel(points, currency)}
          aria-roledescription="gráfico"
          barGap={BAR_GAP}
          margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
        >
          <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            interval={0}
            tickSize={0}
            tickMargin={10}
            tick={MONTH_TICK}
          />
          <YAxis
            width={axis.width}
            axisLine={false}
            tickLine={false}
            ticks={axis.ticks}
            domain={[0, axis.top]}
            tickFormatter={axis.format}
            tickSize={0}
            tickMargin={8}
            tick={AMOUNT_TICK}
          />
          <ChartTooltip
            key={resetKey}
            active={active}
            content={<BarsTooltip onShownChange={onShownChange} />}
            cursor={<ColumnCursor />}
            isAnimationActive={false}
            allowEscapeViewBox={{ x: false, y: true }}
          />
          <Bar
            dataKey="income"
            fill="var(--chart-income)"
            barSize={BAR_WIDTH}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
          <Bar
            dataKey="expense"
            fill="var(--chart-expense)"
            barSize={BAR_WIDTH}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ChartContainer>
      <ChartDataTable
        caption="Ingresos, gastos y ahorro de cada mes"
        columns={["Mes", SERIES_LABELS.income, SERIES_LABELS.expense, SERIES_LABELS.savings]}
        rows={rows.map((row) => ({
          key: row.month,
          header: row.title,
          cells: [row.incomeText, row.expenseText, row.savingsText],
        }))}
      />
    </>
  );
}

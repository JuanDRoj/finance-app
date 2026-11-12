"use client";

import dynamic from "next/dynamic";
import { useIsDesktop } from "@/components/use-is-desktop";
import { hasIncomeOrExpense } from "@/lib/core/dashboard";
import { cn } from "@/lib/utils";
import { ChartBoundary } from "./chart-boundary";
import {
  CHART_HEIGHT_CLASS,
  CHART_MIN_HEIGHT_CLASS,
  INCOME_EXPENSE_EMPTY_TEXT,
  SERIES_LABELS,
  type SeriesChartProps,
} from "./chart-series";
import { ChartLoading, ChartSkeleton } from "./chart-skeleton";

// The grouped bars of Ingresos y gastos, for its card (FE-36, KAN-102; the screen is KAN-84;
// docs/diseno.md D9). Like `net-chart.tsx`, this is the light shell and the bars themselves
// (`income-expense-chart-body.tsx`, with Recharts) load with `next/dynamic` only from 1024 px.

const IncomeExpenseChartBody = dynamic(
  () => import("./income-expense-chart-body").then((module) => module.IncomeExpenseChartBody),
  { loading: ({ error }) => <ChartLoading kind="bars" error={error} /> },
);

export type IncomeExpenseChartProps = SeriesChartProps;

/**
 * The bars of what came in and what went out each month: `points` are the `points` of
 * `GET /dashboard/series` and `currency` the space's. A single month with something still draws all
 * the months (the others empty); only when no month has income or expenses (`hasIncomeOrExpense`) is
 * there nothing to draw, and it says so in text. The legend (`IncomeExpenseLegend`) goes in the
 * header of the card.
 */
export function IncomeExpenseChart({ points, currency }: Readonly<IncomeExpenseChartProps>) {
  const desktop = useIsDesktop();

  if (!hasIncomeOrExpense(points)) {
    return (
      <p
        className={cn(
          "flex items-center text-item text-muted-foreground max-lg:hidden",
          CHART_MIN_HEIGHT_CLASS.bars,
        )}
      >
        {INCOME_EXPENSE_EMPTY_TEXT}
      </p>
    );
  }

  return (
    <div
      data-slot="income-expense-chart"
      className={cn("w-full max-lg:hidden", CHART_HEIGHT_CLASS.bars)}
    >
      {desktop ? (
        <ChartBoundary kind="bars">
          <IncomeExpenseChartBody points={points} currency={currency} />
        </ChartBoundary>
      ) : (
        <ChartSkeleton kind="bars" />
      )}
    </div>
  );
}

/**
 * The key of the colors: a 10 px square (radius 3) and the name of each series, 14 px in `muted`.
 * Always visible (D9: income and expense are close in lightness in the light theme, so the key, the
 * fixed order of the bars, the tooltip and the table are what tell them apart). It does not load
 * Recharts, so the header of the card can show it from the first paint.
 */
export function IncomeExpenseLegend({ className }: Readonly<{ className?: string }>) {
  return (
    <ul
      aria-label="Leyenda del gráfico"
      className={cn(
        "m-0 flex list-none items-center gap-4 p-0 text-sm text-muted-foreground",
        className,
      )}
    >
      <li className="flex items-center gap-2">
        <span aria-hidden className="size-2.5 shrink-0 rounded-swatch bg-chart-income" />
        {SERIES_LABELS.income}
      </li>
      <li className="flex items-center gap-2">
        <span aria-hidden className="size-2.5 shrink-0 rounded-swatch bg-chart-expense" />
        {SERIES_LABELS.expense}
      </li>
    </ul>
  );
}

"use client";

import { useId } from "react";
import { Card } from "@/components/ui/card";
import { describeSeriesSubtitle } from "@/lib/core/dashboard";
import type { DashboardSeries } from "@/lib/core/data/dashboard";
import type { Currency } from "@/lib/core/money";
import { cn } from "@/lib/utils";
import { ChartSkeleton } from "./chart-skeleton";
import { InlineError } from "./dashboard-states";
import { IncomeExpenseChart, IncomeExpenseLegend } from "./income-expense-chart";
import type { Load } from "./use-dashboard-data";

/**
 * "Ingresos y gastos", the card of the grouped bars (FE-24, KAN-84; K-V2-Escritorio, docs/diseno.md D9
 * and D17 › Escritorio v2): the title (19 px), "Últimos 6 meses · octubre en curso", the legend always
 * visible and the chart (220 px). It exists from 1024 px only: below it the whole card is hidden by CSS
 * and the series is not even asked for.
 */
export function IncomeExpenseCard({
  series,
  currency,
  className,
}: Readonly<{ series: Load<DashboardSeries>; currency: Currency; className?: string }>) {
  const titleId = useId();
  const points = series.data?.points;
  return (
    <Card
      variant="tile"
      role="region"
      aria-labelledby={titleId}
      aria-busy={!points && !series.failed ? true : undefined}
      className={cn("max-lg:hidden lg:gap-3.5 lg:px-6 lg:py-5.5", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={titleId} className="font-heading text-card-title font-bold">
            Ingresos y gastos
          </h2>
          {points ? (
            <p className="text-sm text-muted-foreground">{describeSeriesSubtitle(points)}</p>
          ) : null}
        </div>
        <IncomeExpenseLegend />
      </div>
      {points ? (
        <IncomeExpenseChart points={points} currency={currency} />
      ) : series.failed ? (
        <InlineError
          title="No se pudieron cargar los ingresos y gastos"
          error={series.error}
          onRetry={series.retry}
          busy={series.busy}
        />
      ) : (
        <ChartSkeleton kind="bars" />
      )}
    </Card>
  );
}

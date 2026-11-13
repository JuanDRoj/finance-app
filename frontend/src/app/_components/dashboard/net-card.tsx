"use client";

import Image from "next/image";
import { useId } from "react";
import { Card } from "@/components/ui/card";
import {
  describeChartMonth,
  describeNetChange,
  formatDashboardAmount,
  hasHistory,
} from "@/lib/core/dashboard";
import type { DashboardRead, DashboardSeries } from "@/lib/core/data/dashboard";
import type { Currency } from "@/lib/core/money";
import { cn } from "@/lib/utils";
import { ChartSkeleton } from "./chart-skeleton";
import { AmountSkeleton, InlineError } from "./dashboard-states";
import { NetChart } from "./net-chart";
import type { Load } from "./use-dashboard-data";

// The Neto, the hero of the Inicio (FE-24, KAN-84; K-Inicio, K-Tablet and K-V2-Escritorio, docs/diseno.md
// D17 › Escritorio v2 and D9).
//
// - **Below 1024 px:** the label, the chip with the month ("Octubre": the period the figure is as of),
//   the figure (36 px on a phone, 42 from 768 px) and the line that says what it is. No chart, no
//   cricket and no change: a phone does not ask for the series.
// - **From 1024 px:** the figure with the chip of how much it moved this month beside it ("+$ 4.330,00
//   este mes"), the line with "· últimos 6 meses", the evolution (130 px) and the cricket peeking over
//   the right edge of the card (`right: 24px; top: -6px; width: 96px` in the canvas).

type NetCardProps = {
  dashboard: DashboardRead | undefined;
  series: Load<DashboardSeries>;
  currency: Currency;
  className?: string;
};

/** The chip of the change of the month: green for a rise, neutral for a fall or no change (the canvas only draws the rise). */
function ChangeChip({
  dashboard,
  points,
  currency,
}: Readonly<{
  dashboard: DashboardRead;
  points: DashboardSeries["points"];
  currency: Currency;
}>) {
  const change = describeNetChange(dashboard.net_minor, points, currency);
  if (!change) return null;
  return (
    <span
      data-slot="net-change"
      data-direction={change.direction}
      className={cn(
        "rounded-full px-2.5 py-1 text-sm font-bold max-lg:hidden",
        change.direction === "up"
          ? "bg-primary-soft text-secondary-foreground"
          : "bg-foreground/6 text-muted-foreground",
      )}
    >
      {change.text}
    </span>
  );
}

export function NetCard({ dashboard, series, currency, className }: Readonly<NetCardProps>) {
  const labelId = useId();
  const points = series.data?.points;
  const history = points ? hasHistory(points) : false;

  return (
    <Card
      variant="tile"
      role="region"
      aria-labelledby={labelId}
      aria-busy={dashboard === undefined || undefined}
      className={cn("relative gap-2 p-5 md:p-6 lg:gap-2 lg:px-6 lg:pt-5.5 lg:pb-4", className)}
    >
      {/* Decorative: it carries no information. It sits inside the card and only 6 px of its head
          rise over the edge, so it needs no room above. Under the text, so a figure that wraps never hides. */}
      <Image
        src="/brand/kanza-peek.svg"
        alt=""
        width={96}
        height={72}
        className="pointer-events-none absolute -top-1.5 right-6 z-0 h-auto w-24 max-lg:hidden"
      />
      <div className="relative z-10 flex items-center justify-between gap-3 lg:justify-start">
        <h2 id={labelId} className="text-item font-semibold text-muted-foreground lg:font-bold">
          Neto
        </h2>
        {dashboard ? (
          <span
            data-slot="net-month"
            className="rounded-full bg-primary-soft px-2.5 py-1 text-caption font-bold text-secondary-foreground lg:hidden"
          >
            {describeChartMonth(dashboard.month)}
          </span>
        ) : null}
      </div>
      <div className="relative z-10 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {dashboard ? (
          <>
            <p className="font-heading text-4xl leading-net font-semibold tracking-title tabular-nums wrap-anywhere md:text-net">
              {formatDashboardAmount(dashboard.net_minor, currency)}
            </p>
            {points ? (
              <ChangeChip dashboard={dashboard} points={points} currency={currency} />
            ) : null}
          </>
        ) : (
          <AmountSkeleton className="h-10 w-48" />
        )}
      </div>
      <p className="relative z-10 text-sm text-muted-foreground md:text-item lg:text-sm">
        Tu disponible menos la deuda de tarjetas
        {history && points ? (
          <span className="max-lg:hidden"> · últimos {points.length} meses</span>
        ) : null}
      </p>
      <div className="relative z-10 max-lg:hidden lg:mt-1.5">
        {points ? (
          <NetChart points={points} currency={currency} />
        ) : series.failed ? (
          <InlineError
            title="No se pudo cargar la evolución"
            error={series.error}
            onRetry={series.retry}
            busy={series.busy}
          />
        ) : (
          <ChartSkeleton kind="net" />
        )}
      </div>
    </Card>
  );
}

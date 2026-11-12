"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  XAxis,
  YAxis,
  type DotItemDotProps,
  type TooltipContentProps,
  type XAxisTickContentProps,
} from "recharts";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import {
  describeChartMonth,
  describeNetChartLabel,
  formatDashboardAmount,
  formatMonthShort,
  netChartDomain,
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

// The area of the Neto (FE-36, KAN-102; docs/diseno.md D9; K-V2-Escritorio): one color (`primary`, the
// line at 2 px and the area at 14 %), no Y axis and no grid, a dot on each month (8 px; 12 px on the
// last, which is today, and on the one under the mouse or the keyboard) with a 2 px edge of the card's
// color, and the months under it with the first and the last aligned to the edges, as the canvas does
// with `space-between`. This is the part that loads Recharts: the shell (`net-chart.tsx`) only loads it
// from 1024 px.

/** Space kept at each side of the plot so the edge dots (12 px) and the edge labels are not cut. */
const EDGE_PADDING = 12;
/** The 8 px dot and the 12 px one, as the circle's radius up to the middle of its 2 px edge. */
const DOT_RADIUS = 3;
const BIG_DOT_RADIUS = 5;
const DOT_EDGE = 2;

type NetRow = {
  month: string;
  /** The label of the axis: "Oct". */
  label: string;
  /** The tooltip's title: "Octubre (hoy)". */
  title: string;
  net: number;
  /** The net as the tooltip and the table write it. */
  text: string;
};

function buildRows(points: SeriesChartProps["points"], currency: SeriesChartProps["currency"]) {
  return points.map((point, index): NetRow => ({
    month: point.month,
    label: formatMonthShort(point.month),
    title: describeChartMonth(point.month, index === points.length - 1 ? "hoy" : undefined),
    net: point.net_minor,
    text: formatDashboardAmount(point.net_minor, currency),
  }));
}

/** Recharts hands its own props to the element given as `content`; `onShownChange` is ours. */
type NetTooltipProps = Partial<TooltipContentProps> & {
  onShownChange: (index: string | null) => void;
};

function NetTooltip({ active, payload, activeIndex, onShownChange }: NetTooltipProps) {
  const row = payload?.[0]?.payload as NetRow | undefined;
  if (!active || !row) return null;
  return (
    <ChartTooltipCard title={row.title} shownAt={activeIndex} onShownChange={onShownChange}>
      <ChartTooltipRow label={SERIES_LABELS.net} value={row.text} />
    </ChartTooltipCard>
  );
}

/** The month under a dot. The first one is aligned to the left edge and the last to the right one. */
function MonthTick({ x, y, payload, index, visibleTicksCount }: XAxisTickContentProps) {
  const first = index === 0;
  const last = !first && index === visibleTicksCount - 1;
  const anchorX = Number(x) + (first ? -EDGE_PADDING : last ? EDGE_PADDING : 0);
  return (
    <text
      x={anchorX}
      y={Number(y)}
      dy="0.71em"
      textAnchor={first ? "start" : last ? "end" : "middle"}
      className="fill-muted-foreground text-caption"
    >
      {String(payload.value)}
    </text>
  );
}

/** A dot of the line; the last one (today) is the big one. */
function NetDot({ cx, cy, index, points }: DotItemDotProps) {
  return (
    <circle
      key={index}
      cx={cx}
      cy={cy}
      r={index === points.length - 1 ? BIG_DOT_RADIUS : DOT_RADIUS}
      fill="var(--primary)"
      stroke="var(--surface)"
      strokeWidth={DOT_EDGE}
    />
  );
}

const ACTIVE_DOT = {
  r: BIG_DOT_RADIUS,
  fill: "var(--primary)",
  stroke: "var(--surface)",
  strokeWidth: DOT_EDGE,
} as const;

export function NetChartBody({ points, currency }: Readonly<SeriesChartProps>) {
  const rows = useMemo(() => buildRows(points, currency), [points, currency]);
  const domain = useMemo(() => netChartDomain(points), [points]);
  const { active, resetKey, containerProps, chartProps, onShownChange } = useDismissibleTooltip();

  return (
    <>
      <ChartContainer
        {...containerProps}
        className={CHART_HEIGHT_CLASS.net}
        initialDimension={{ width: 640, height: CHART_HEIGHT_PX.net }}
      >
        <AreaChart
          {...chartProps}
          data={rows}
          accessibilityLayer
          aria-label={describeNetChartLabel(points, currency)}
          aria-roledescription="gráfico"
          margin={{ top: 10, right: 8, bottom: 0, left: 8 }}
        >
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            interval={0}
            tickSize={0}
            tickMargin={8}
            padding={{ left: EDGE_PADDING, right: EDGE_PADDING }}
            tick={MonthTick}
            height={30}
          />
          <YAxis hide domain={domain} />
          <ChartTooltip
            key={resetKey}
            active={active}
            content={<NetTooltip onShownChange={onShownChange} />}
            cursor={false}
            isAnimationActive={false}
            allowEscapeViewBox={{ x: false, y: true }}
          />
          <Area
            dataKey="net"
            type="linear"
            stroke="var(--primary)"
            strokeWidth={2}
            strokeLinejoin="round"
            fill="var(--primary)"
            fillOpacity={0.14}
            baseValue={domain[0]}
            dot={NetDot}
            activeDot={ACTIVE_DOT}
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartContainer>
      <ChartDataTable
        caption="Neto al cierre de cada mes"
        columns={["Mes", SERIES_LABELS.net]}
        rows={rows.map((row) => ({ key: row.month, header: row.title, cells: [row.text] }))}
      />
    </>
  );
}

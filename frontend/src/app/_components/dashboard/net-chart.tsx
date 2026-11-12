"use client";

import dynamic from "next/dynamic";
import { useIsDesktop } from "@/components/use-is-desktop";
import { hasHistory } from "@/lib/core/dashboard";
import { ChartBoundary } from "./chart-boundary";
import {
  CHART_HEIGHT_CLASS,
  CHART_MIN_HEIGHT_CLASS,
  NET_NO_HISTORY_TEXT,
  type SeriesChartProps,
} from "./chart-series";
import { ChartLoading, ChartSkeleton } from "./chart-skeleton";
import { cn } from "@/lib/utils";

// The evolution of the Neto, for the card of the Neto (FE-36, KAN-102; the screen is KAN-84;
// docs/diseno.md D9). This file is the light shell: the area itself (`net-chart-body.tsx`, with
// Recharts) is loaded with `next/dynamic` and **only from 1024 px**, where the card exists (below it
// the card has no chart). The shell holds the chart's height with CSS (`max-lg:hidden`, a fixed
// height), so the card does not jump when the code arrives, and `useIsDesktop` — false on the server
// and while hydrating — is what decides to mount it.

const NetChartBody = dynamic(
  () => import("./net-chart-body").then((module) => module.NetChartBody),
  {
    loading: ({ error }) => <ChartLoading kind="net" error={error} />,
  },
);

export type NetChartProps = SeriesChartProps;

/**
 * The area of the Neto of the last months: `points` are the `points` of `GET /dashboard/series`
 * (oldest first, the last one the current month, whose net is today's) and `currency` the space's.
 * With a single month of history (`hasHistory`) there is nothing to draw — a line "from 0" would be
 * a lie — and it says so in text instead.
 */
export function NetChart({ points, currency }: Readonly<NetChartProps>) {
  const desktop = useIsDesktop();

  if (!hasHistory(points)) {
    return (
      <p
        className={cn(
          "flex items-center text-item text-muted-foreground max-lg:hidden",
          CHART_MIN_HEIGHT_CLASS.net,
        )}
      >
        {NET_NO_HISTORY_TEXT}
      </p>
    );
  }

  return (
    <div data-slot="net-chart" className={cn("w-full max-lg:hidden", CHART_HEIGHT_CLASS.net)}>
      {desktop ? (
        <ChartBoundary kind="net">
          <NetChartBody points={points} currency={currency} />
        </ChartBoundary>
      ) : (
        <ChartSkeleton kind="net" />
      )}
    </div>
  );
}

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CHART_HEIGHT_CLASS, type ChartKind } from "./chart-series";

/** The block that holds a chart's place, with its exact height, while the chart's code loads. */
export function ChartSkeleton({ kind }: Readonly<{ kind: ChartKind }>) {
  return (
    <div aria-busy="true" className={cn("w-full", CHART_HEIGHT_CLASS[kind])}>
      <Skeleton className="size-full rounded-card" />
    </div>
  );
}

/**
 * What `next/dynamic` shows while a chart's code loads (`loading`). In the App Router a failed import
 * throws and `ChartBoundary` catches it; the loader of the Pages Router, which is what the tests get,
 * hands the error to `loading` instead, where the skeleton would pulse forever. So an error is thrown
 * from here too, and the boundary is what answers it in both.
 */
export function ChartLoading({ kind, error }: Readonly<{ kind: ChartKind; error?: Error | null }>) {
  if (error) throw error;
  return <ChartSkeleton kind={kind} />;
}

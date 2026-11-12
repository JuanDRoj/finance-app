"use client";

import type { ComponentProps } from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "@/lib/utils";

/**
 * The container of a Recharts chart, from shadcn's `chart.tsx` (docs/diseno.md D9), adapted to this
 * project:
 *
 * - No `ChartConfig` and no `ChartStyle`: shadcn writes a `<style>` with one color per theme under a
 *   `.dark` selector, and this project has no `.dark` class (dark follows `prefers-color-scheme`).
 *   The series take their colors straight from the tokens (`var(--chart-income)`), which already
 *   change with the theme.
 * - No `aspect-video`: the height comes from the caller (`className`).
 * - The keyboard focus of the chart is **visible**. `accessibilityLayer` (the default of Recharts 3)
 *   makes the `<svg>` focusable, and shadcn hides its outline (`outline-hidden`), which would leave
 *   a keyboard user with no sign of where the focus is. Never hide it (`chart-source.test.ts` guards it).
 * - The tooltip is not shadcn's `ChartTooltipContent` (`bg-background`): the canvas draws it inverted
 *   (`tooltip` tokens), so each chart brings its own content (`dashboard/chart-tooltip-card.tsx`).
 *
 * `initialDimension` is what is drawn before the container is measured (and always, in jsdom, which
 * has no `ResizeObserver`).
 */
function ChartContainer({
  className,
  children,
  initialDimension = { width: 640, height: 220 },
  ...props
}: ComponentProps<"div"> & {
  children: ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
  initialDimension?: { width: number; height: number };
}) {
  return (
    <div
      data-slot="chart"
      className={cn(
        "flex w-full min-w-0 justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-surface]:focus-visible:outline-2 [&_.recharts-surface]:focus-visible:outline-offset-2 [&_.recharts-surface]:focus-visible:outline-ring [&_.recharts-surface]:focus-visible:outline-solid",
        className,
      )}
      {...props}
    >
      <RechartsPrimitive.ResponsiveContainer initialDimension={initialDimension}>
        {children}
      </RechartsPrimitive.ResponsiveContainer>
    </div>
  );
}

const ChartTooltip = RechartsPrimitive.Tooltip;

export { ChartContainer, ChartTooltip };

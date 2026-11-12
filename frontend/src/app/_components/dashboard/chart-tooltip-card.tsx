"use client";

import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// The tooltip of both charts (K-V2-Escritorio): inverted against the page (`tooltip` tokens, as the
// sidebar's), the month in bold and one row per figure. It is announced politely when the keyboard
// moves from one month to the next. The color of a series is not repeated in it (the legend says
// it, and a swatch of `chart-income` on the light tooltip of the dark theme would not reach 3:1).

/**
 * The card. `className` sets its width (the bars' is 190 px). The charts draw it only while their
 * tooltip is showing, so it mounts when the tooltip appears and unmounts when it goes: that is what
 * `onShownChange` reports (`use-dismissible-tooltip.ts` listens for Escape only in between).
 */
export function ChartTooltipCard({
  title,
  className,
  onShownChange,
  children,
}: Readonly<{
  title: string;
  className?: string;
  onShownChange?: (shown: boolean) => void;
  children: ReactNode;
}>) {
  useEffect(() => {
    onShownChange?.(true);
    return () => onShownChange?.(false);
  }, [onShownChange]);

  return (
    <div
      data-slot="chart-tooltip"
      role="status"
      aria-live="polite"
      className={cn(
        "min-w-36 max-w-[190px] rounded-chart-tooltip bg-tooltip px-3 py-2.5 text-tooltip-label text-tooltip-foreground shadow-tooltip",
        className,
      )}
    >
      <p className="font-bold wrap-anywhere">{title}</p>
      {children}
    </div>
  );
}

/** A figure: its name on the left and the amount, tabular and breakable, on the right. */
export function ChartTooltipRow({
  label,
  value,
  separated = false,
}: Readonly<{ label: string; value: string; separated?: boolean }>) {
  return (
    <div
      className={cn(
        "mt-1.5 flex items-baseline justify-between gap-3",
        separated && "border-t border-tooltip-foreground/15 pt-1.5",
      )}
    >
      <span>{label}</span>
      <span className="min-w-0 text-right font-semibold tabular-nums wrap-anywhere">{value}</span>
    </div>
  );
}

"use client";

import { CalendarBlank, CaretDown } from "@phosphor-icons/react/ssr";
import { useMemo } from "react";
import { buildMonthOptions } from "@/lib/core/movements";
import { cn } from "@/lib/utils";
import { COMPACT_CONTROL, FILTER_PILL } from "./filter-control";

/**
 * The month of desktop (K-V2-Escritorio, "movimientos"): a button-looking pill with a calendar, "Octubre
 * 2026" and a caret. It is a **native `<select>`** dressed like that (docs/diseno.md D19, FE-22): the
 * keyboard, the screen reader and the system picker on a tablet all work with no code. The list is
 * the months from six ahead to 36 back and, always, the one that is chosen (`buildMonthOptions`), so
 * a link to an older month still names it. Nothing draws the list: the canvas has no open state.
 *
 * `variant="compact"` is the button of the detail of an account (K-V2-Escritorio, "cuentas"): 36 px,
 * radius 10 and no calendar, just "Octubre 2026" and the caret (`COMPACT_CONTROL`). The default is
 * the pill of the filters card of Movimientos.
 */
export function MonthSelect({
  month,
  currentMonth,
  onMonthChange,
  variant = "pill",
  className,
}: Readonly<{
  month: string;
  currentMonth: string;
  onMonthChange: (month: string) => void;
  variant?: "pill" | "compact";
  className?: string;
}>) {
  const options = useMemo(() => buildMonthOptions(month, currentMonth), [month, currentMonth]);
  const compact = variant === "compact";
  return (
    <div data-slot="month-select" className={cn("relative inline-flex", className)}>
      {compact ? null : (
        <CalendarBlank
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2"
        />
      )}
      <select
        aria-label="Mes"
        value={month}
        onChange={(event) => onMonthChange(event.target.value)}
        className={cn(
          compact ? COMPACT_CONTROL : FILTER_PILL,
          "cursor-pointer appearance-none",
          compact ? "pr-8 pl-3" : "pr-9 pl-10",
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <CaretDown
        aria-hidden
        weight="bold"
        className={cn(
          "pointer-events-none absolute top-1/2 size-3 -translate-y-1/2",
          compact ? "right-3" : "right-4",
        )}
      />
    </div>
  );
}

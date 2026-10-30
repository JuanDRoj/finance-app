"use client";

import type { MovementFilters, MovementFiltersPatch } from "@/lib/core/movements";
import { cn } from "@/lib/utils";
import { MonthSelect } from "./month-select";
import { TypeChips } from "./type-chips";

/**
 * The filters card of desktop (K-V2-Escritorio, "movimientos"; from 1024 px, the screen hides it
 * below): a solid `surface` card of radius 20 with one row of controls, 10 px apart, that wraps to a
 * second row when the window is short (at 1024 px). Today it holds the month and the type; the
 * search box (first, it takes the room that is left) and the account and category selects (between
 * the month and the type) are FE-33's, and join the same `flex-wrap` row without rebuilding it.
 * The controls wear `FILTER_PILL`.
 */
export function MovementFiltersCard({
  filters,
  currentMonth,
  onChange,
  className,
}: Readonly<{
  filters: MovementFilters;
  currentMonth: string;
  onChange: (patch: MovementFiltersPatch) => void;
  className?: string;
}>) {
  return (
    <section
      aria-label="Filtros"
      data-slot="movement-filters"
      className={cn(
        "flex flex-wrap items-center gap-2.5 rounded-card border border-border bg-surface px-4 py-3.5",
        className,
      )}
    >
      <MonthSelect
        month={filters.month}
        currentMonth={currentMonth}
        onMonthChange={(month) => onChange({ month })}
      />
      <TypeChips type={filters.type} onTypeChange={(type) => onChange({ type })} />
    </section>
  );
}

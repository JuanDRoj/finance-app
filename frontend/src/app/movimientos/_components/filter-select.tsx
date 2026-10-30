"use client";

import { CaretDown } from "@phosphor-icons/react/ssr";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { FILTER_PILL } from "./filter-control";

/**
 * A select of the filters card on desktop (K-V2-Escritorio, "movimientos"): a native `<select>` dressed
 * as a pill of 42 px (`FILTER_PILL`: 44 and 16 px for a finger) with a caret, and no visible label
 * (the canvas draws none; its name is `label`). The text of the chosen option is cut with "…" at 224
 * px, so an account or a category of 80 characters does not stretch the row; the list that opens
 * shows the whole name. Children are the `<option>`s.
 */
export function FilterSelect({
  label,
  value,
  onValueChange,
  disabled,
  title,
  children,
  className,
}: Readonly<{
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  /** Why it is off, for a mouse (a list that did not load). */
  title?: string;
  children: ReactNode;
  className?: string;
}>) {
  return (
    <div
      data-slot="filter-select"
      className={cn("relative inline-flex min-w-0 max-w-56", className)}
    >
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        title={title}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn(
          FILTER_PILL,
          "w-full min-w-0 cursor-pointer appearance-none truncate pr-9 pl-3.5",
          "disabled:cursor-not-allowed disabled:opacity-60",
        )}
      >
        {children}
      </select>
      <CaretDown
        aria-hidden
        weight="bold"
        className="pointer-events-none absolute top-1/2 right-4 size-3 -translate-y-1/2"
      />
    </div>
  );
}

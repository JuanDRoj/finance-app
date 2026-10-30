"use client";

import { Funnel } from "@phosphor-icons/react/ssr";
import type { Ref } from "react";
import { focusRing } from "@/components/ui/focus";
import { describeFilterButton } from "@/lib/core/movements";
import { cn } from "@/lib/utils";

/**
 * "Filtrar" in the row of the month of a phone (K-H1-Movimientos): a glass pill of 44 px with a funnel,
 * the word in 14 px bold and, with filters on, a circle with their number. The sheet it opens holds the
 * account and the category, the two filters the screen does not show, so the number counts those two
 * (`activeFilterCount`). The number is for the eye (`aria-hidden`); the name says it in words
 * (`describeFilterButton`: "Filtrar, 1 filtro activo"). From 1024 px it is not there: the filters are in
 * the card.
 *
 * `onWarmUp` (the pointer going down, the focus) is for loading the sheet before the click finishes.
 */
export function FilterButton({
  count,
  onClick,
  onWarmUp,
  ref,
  className,
}: Readonly<{
  count: number;
  onClick: () => void;
  onWarmUp?: () => void;
  ref?: Ref<HTMLButtonElement>;
  className?: string;
}>) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={describeFilterButton(count)}
      onClick={onClick}
      onPointerDown={onWarmUp}
      onFocus={onWarmUp}
      className={cn(
        "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-input bg-glass px-3.5 text-sm font-bold text-foreground select-none lg:hidden",
        "transition-[transform,filter] duration-150 ease-out active:scale-[0.97] hover:brightness-95",
        focusRing,
        className,
      )}
    >
      <Funnel aria-hidden className="size-4" />
      Filtrar
      {count > 0 ? (
        <span
          aria-hidden
          className="inline-flex h-5.5 min-w-5.5 items-center justify-center rounded-full bg-primary px-1.5 text-caption font-bold text-primary-foreground"
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

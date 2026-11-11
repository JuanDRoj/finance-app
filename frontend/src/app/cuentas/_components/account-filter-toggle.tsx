"use client";

import { Funnel } from "@phosphor-icons/react/ssr";
import type { Ref } from "react";
import { describeFilterButton } from "@/lib/core/movements";
import { cn } from "@/lib/utils";
import { COMPACT_CONTROL } from "@/app/movimientos/_components/filter-control";

/**
 * "Filtrar" in the header of the movements of an account (K-V2-Escritorio, "cuentas"): a compact
 * control of 36 px with a funnel and the word in 14 px bold. It is a **disclosure**: it shows or hides
 * the row with the types (`aria-expanded`, `aria-controls`), and with a type chosen it carries a circle
 * with the number, for the eye (`aria-hidden`); the name says it in words ("Filtrar, 1 filtro activo",
 * `describeFilterButton`, which starts with the visible word as WCAG 2.5.3 wants).
 */
export function AccountFilterToggle({
  open,
  count,
  controls,
  onToggle,
  ref,
}: Readonly<{
  open: boolean;
  count: number;
  /** The `id` of the row that this button shows and hides. */
  controls: string;
  onToggle: () => void;
  ref?: Ref<HTMLButtonElement>;
}>) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={describeFilterButton(count)}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className={cn(
        COMPACT_CONTROL,
        "inline-flex shrink-0 cursor-pointer items-center gap-1.5 px-3 select-none",
        "transition-[transform,filter] duration-150 ease-out active:scale-[0.97] hover:brightness-95",
        open && "bg-accent",
      )}
    >
      <Funnel aria-hidden className="size-3.5" />
      Filtrar
      {count > 0 ? (
        <span
          aria-hidden
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-caption font-bold text-primary-foreground"
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

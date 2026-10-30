"use client";

import type { MovementTypeFilter } from "@/lib/core/movements";
import { cn } from "@/lib/utils";
import { focusRing } from "@/components/ui/focus";

type Chip = { type: MovementTypeFilter | undefined; label: string; short?: string };

const CHIPS: readonly Chip[] = [
  { type: undefined, label: "Todos" },
  { type: "expense", label: "Gastos" },
  { type: "income", label: "Ingresos" },
  { type: "transfer", label: "Transferencias", short: "Transf." },
];

/**
 * The type of movement to show: Todos · Gastos · Ingresos · Transferencias (docs/diseno.md D17, D19;
 * K-H1-Movimientos and K-V2-Escritorio). Buttons with `aria-pressed` in a group, one pressed at a
 * time. One markup, two skins:
 *
 * - **Phone:** separate chips of their natural width (they grow to fill the row if there is room,
 *   and wrap if there is not), 44 px tall, with a glass fill and, the chosen one, `primary`. The
 *   border of the others is `--input`, not the almost invisible white of the canvas: the border
 *   of a control must reach 3:1.
 * - **Desktop:** the four inside one segmented pill (4 px of padding), buttons of 34 px (44 with a
 *   finger), the chosen one `primary`.
 *
 * A chip that is not chosen lights up with `accent` under a mouse (`hover:bg-accent`, what the
 * project's segmented control does); the chosen one stays `primary`.
 *
 * The last chip says "Transf." on a phone and "Transferencias" from 1024 px, but its name is always
 * "Transferencias" (the short text is hidden from assistive technology).
 */
export function TypeChips({
  type,
  onTypeChange,
  className,
}: Readonly<{
  type: MovementTypeFilter | undefined;
  onTypeChange: (type: MovementTypeFilter | undefined) => void;
  className?: string;
}>) {
  return (
    <div
      role="group"
      aria-label="Tipo de movimiento"
      data-slot="type-chips"
      className={cn(
        "flex flex-wrap gap-2 lg:w-fit lg:flex-nowrap lg:gap-1 lg:rounded-full lg:bg-foreground/6 lg:p-1",
        className,
      )}
    >
      {CHIPS.map((chip) => {
        const pressed = chip.type === type;
        return (
          <button
            key={chip.label}
            type="button"
            aria-pressed={pressed}
            onClick={() => onTypeChange(chip.type)}
            className={cn(
              "min-h-11 flex-auto cursor-pointer rounded-full border px-3.5 text-sm select-none",
              "transition-[transform,filter] duration-150 ease-out active:scale-[0.97]",
              "lg:min-h-8.5 lg:flex-none lg:border-0 lg:pointer-coarse:min-h-11",
              pressed
                ? "border-primary bg-primary font-bold text-primary-foreground"
                : "border-input bg-glass font-semibold text-foreground hover:bg-accent lg:bg-transparent",
              focusRing,
            )}
          >
            {chip.short ? (
              <>
                <span aria-hidden className="lg:hidden">
                  {chip.short}
                </span>
                <span className="sr-only lg:not-sr-only">{chip.label}</span>
              </>
            ) : (
              chip.label
            )}
          </button>
        );
      })}
    </div>
  );
}

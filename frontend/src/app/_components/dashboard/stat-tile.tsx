"use client";

import type { ReactNode } from "react";
import { useId } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AmountSkeleton } from "./dashboard-states";

// A tile with one figure (FE-24, KAN-84; K-Inicio, K-Tablet and K-V2-Escritorio, docs/diseno.md D17 ›
// Escritorio v2): Disponible, Deuda de tarjetas and, from 1024 px, "Gastos de octubre". One markup, two
// looks, as the canvas draws them: below 1024 px a column (the icon on top, then the label, the amount
// and the note; 38 px for the icon and 18 px for the amount on a phone, 40 and 20 from 768 px) in a
// glass tile of 28 px of radius; from 1024 px a row (the icon on the left, 42 px, and the text beside
// it with the amount at 24 px) in a solid card of 20.

export type StatTone = "default" | "debt";

type StatTileProps = {
  /** The name of the figure: "Disponible". */
  label: string;
  /** The amount, already formatted; `undefined` while it loads. */
  value: string | undefined;
  /** The Phosphor icon of the tile (duotone, decorative). */
  icon: ReactNode;
  /** `debt` colors the amount and the icon tile with the debt color (Deuda de tarjetas, when something is owed). */
  tone?: StatTone;
  /** The line under the amount: "2 bancos y efectivo". Left out while it is not known. */
  note?: ReactNode;
  /** The classes of the note, for the one that only shows from 768 px. */
  noteClassName?: string;
  className?: string;
};

export function StatTile({
  label,
  value,
  icon,
  tone = "default",
  note,
  noteClassName,
  className,
}: StatTileProps) {
  const labelId = useId();
  return (
    <Card
      variant="tile"
      role="region"
      aria-labelledby={labelId}
      aria-busy={value === undefined || undefined}
      className={cn(
        "gap-2 p-3.5 md:p-4.5 lg:flex-1 lg:flex-row lg:items-center lg:gap-3.5 lg:px-5 lg:py-4.5",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-9.5 shrink-0 items-center justify-center rounded-icon md:size-10 lg:size-10.5",
          tone === "debt" ? "bg-debt/10 text-debt dark:bg-debt/14" : "bg-primary-soft text-primary",
          "[&_svg]:size-5.5",
        )}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5 lg:gap-0.5">
        <h2 id={labelId} className="text-sm font-medium text-muted-foreground lg:font-bold">
          {label}
        </h2>
        {value === undefined ? (
          <AmountSkeleton className="mt-0.5" />
        ) : (
          <p
            className={cn(
              "font-heading text-lg font-semibold tracking-stat tabular-nums wrap-anywhere md:text-xl lg:text-2xl",
              tone === "debt" && "text-debt",
            )}
          >
            {value}
          </p>
        )}
        {note ? (
          <p className={cn("text-caption text-muted-foreground", noteClassName)}>{note}</p>
        ) : null}
      </div>
    </Card>
  );
}

"use client";

import { CaretLeft, CaretRight } from "@phosphor-icons/react/ssr";
import { Button } from "@/components/ui/button";
import { formatMonth } from "@/lib/core/dates";
import { shiftMonth } from "@/lib/core/movements";

/**
 * The month of a phone, with "Mes anterior" and "Mes siguiente" (K-H1-Movimientos): two arrows of
 * 44 px around "Octubre 2026" (16 px in bold, at least 112 px wide). An
 * arrow is off at the end of the months the backend takes (1900-01 and 2199-12); it stays in the
 * tab order and says it is off, like every button of the project. The month after the current one
 * is allowed: a movement can be dated in the future.
 *
 * It is only the group of three: the row it sits in is the screen's, which has "Filtrar" on the right.
 * From 1024 px the screen uses `MonthSelect` instead. It does not announce the month by itself (no
 * `aria-live`): the `status` region of the screen says the month and the count in one go, so a change
 * of month is announced once.
 */
export function MonthNav({
  month,
  onMonthChange,
  className,
}: Readonly<{ month: string; onMonthChange: (month: string) => void; className?: string }>) {
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  return (
    <div role="group" aria-label="Mes" data-slot="month-nav" className={className}>
      <div className="flex items-center">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Mes anterior"
          disabled={previous === null}
          onClick={() => previous && onMonthChange(previous)}
          className="[&_svg]:size-4.5"
        >
          <CaretLeft aria-hidden weight="bold" />
        </Button>
        <span className="min-w-28 text-center text-base font-bold">{formatMonth(month)}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Mes siguiente"
          disabled={next === null}
          onClick={() => next && onMonthChange(next)}
          className="[&_svg]:size-4.5"
        >
          <CaretRight aria-hidden weight="bold" />
        </Button>
      </div>
    </div>
  );
}

"use client";

import { memo, useId } from "react";
import type { MovementListItem } from "@/lib/core/data/transactions";
import type { DayGroup } from "@/lib/core/movements";
import type { Currency } from "@/lib/core/money";
import { cn } from "@/lib/utils";
import { MovementRow } from "./movement-row";

/**
 * The movements of one day on a phone (docs/diseno.md D19): the title ("Hoy · jueves 22 de
 * octubre", 14 px bold in `muted-foreground`, an `h2`) and a glass card with the rows, split by
 * a line. The canvas rounds the card at 24 px; the nearest token is `rounded-tile` (28 px), as in
 * Categorías.
 */
export function MovementDayGroup({
  group,
  currency,
}: Readonly<{ group: DayGroup<MovementListItem>; currency: Currency }>) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2 pt-2.5">
      <h2 id={headingId} className="mx-1 text-sm font-bold text-muted-foreground">
        {group.title}
      </h2>
      <ul className="card-surface divide-y divide-border overflow-hidden rounded-tile">
        {group.items.map((item) => (
          <MovementRow key={item.id} item={item} currency={currency} />
        ))}
      </ul>
    </section>
  );
}

type MovementDayGroupsProps = {
  groups: readonly DayGroup<MovementListItem>[];
  currency: Currency;
  /** The screen hides it from 1024 px (`lg:hidden`): there the table takes its place. */
  className?: string;
};

/**
 * The whole list of a phone: one `MovementDayGroup` per day, 4 px apart (plus the 10 px above each
 * title). Memoized: the screen re-renders for reasons that do not change the rows (a page being
 * fetched, a status flag), and with hundreds of rows loaded that is worth avoiding; it needs the
 * `groups` to be the same array until the data change (`useMemo` on `groupMovementsByDay`).
 */
export const MovementDayGroups = memo(function MovementDayGroups({
  groups,
  currency,
  className,
}: MovementDayGroupsProps) {
  return (
    <div data-slot="movement-day-groups" className={cn("flex flex-col gap-1", className)}>
      {groups.map((group) => (
        <MovementDayGroup
          key={`${group.date}:${group.items[0]?.id}`}
          group={group}
          currency={currency}
        />
      ))}
    </div>
  );
});

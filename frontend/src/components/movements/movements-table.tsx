"use client";

import { ArrowDown } from "@phosphor-icons/react/ssr";
import { memo } from "react";
import type { MovementListItem } from "@/lib/core/data/transactions";
import {
  describeMovementAccount,
  describeMovementCategory,
  describeMovementStatusNote,
  describeMovementTitle,
  formatMovementDate,
  movementAmountView,
} from "@/lib/core/movements";
import type { Currency } from "@/lib/core/money";
import { cn } from "@/lib/utils";
import { AMOUNT_TONE_CLASS } from "./amount-tone";

type MovementsTableProps = {
  items: readonly MovementListItem[];
  currency: Currency;
  /** The space's day (`todayInTimezone`): a date of another year is written with its year. */
  today?: string;
  /** What a screen reader hears as the name of the table. */
  caption?: string;
  /** The screen hides it below 1024 px (`max-lg:hidden`): there the day groups take its place. */
  className?: string;
};

const HEAD = "px-2 py-2.5 text-left font-bold";

/**
 * The movements as a table, from 1024 px (docs/diseno.md D17 › Escritorio v2; K-V2-Escritorio,
 * "movimientos"): Fecha, Descripción, Categoría, Cuenta and Monto, in rows of 48 px with Karla 15.
 * A real `table`: a caption for its name, `th scope="col"` for the columns and the description as
 * the row's header.
 *
 * - **Order.** The backend only sorts by date, newest first, so Fecha carries `aria-sort="descending"`
 *   and is not a button; Monto is not sortable (the canvas draws both as sort buttons: that needs
 *   `sort` in `GET /transactions`, which does not exist yet).
 * - **Read only** (FE-22): no link, no action column. FE-23 adds the row's actions and opens them.
 * - **Width.** The table lets each column size to its content with a floor of 760 px, inside a
 *   scroller as the canvas draws it. The description wraps (two lines) and the category and the
 *   account are cut with "…" (the whole text is in `title`); the amount is never cut, so only an
 *   amount of 16 digits in a narrow window makes the scroller scroll. At 1024 px the content
 *   is about 720 px wide, so it may scroll a little there; from 1280 px it does not.
 * - A transfer and an adjustment are quiet: a neutral chip and `muted-foreground` amount.
 */
export const MovementsTable = memo(function MovementsTable({
  items,
  currency,
  today,
  caption = "Movimientos",
  className,
}: MovementsTableProps) {
  return (
    <div data-slot="movements-table" className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-190 border-collapse text-item">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-caption text-muted-foreground">
            <th scope="col" aria-sort="descending" className={cn(HEAD, "pl-0")}>
              <span className="inline-flex items-center gap-1 text-foreground">
                Fecha
                <ArrowDown aria-hidden className="size-3" />
              </span>
            </th>
            <th scope="col" className={HEAD}>
              Descripción
            </th>
            <th scope="col" className={HEAD}>
              Categoría
            </th>
            <th scope="col" className={HEAD}>
              Cuenta
            </th>
            <th scope="col" className={cn(HEAD, "text-right")}>
              Monto
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <MovementTableRow key={item.id} item={item} currency={currency} today={today} />
          ))}
        </tbody>
      </table>
    </div>
  );
});

function MovementTableRow({
  item,
  currency,
  today,
}: Readonly<{ item: MovementListItem; currency: Currency; today?: string }>) {
  const title = describeMovementTitle(item);
  const category = describeMovementCategory(item);
  const account = describeMovementAccount(item);
  const amount = movementAmountView(item, currency);
  const status = describeMovementStatusNote(item);
  return (
    <tr data-slot="movement-row" data-type={item.type} className="border-t border-border">
      <td className="h-12 py-0 pr-2 whitespace-nowrap text-muted-foreground">
        {formatMovementDate(item.date, today)}
      </td>
      <th scope="row" className="min-w-44 px-2 py-1.5 text-left font-bold">
        <span title={title} className="line-clamp-2 wrap-anywhere">
          {title}
        </span>
        {status ? (
          <span className="block text-caption font-semibold text-muted-foreground">{status}</span>
        ) : null}
      </th>
      <td className="px-2">
        <span
          title={category.label}
          className={cn(
            "inline-block max-w-56 truncate rounded-full px-2.5 py-0.5 align-middle text-caption font-bold",
            category.quiet
              ? "bg-foreground/6 text-muted-foreground"
              : "bg-primary-soft text-secondary-foreground",
          )}
        >
          {category.label}
        </span>
      </td>
      <td className="px-2 text-muted-foreground">
        <span title={account} className="block max-w-44 truncate">
          {account}
        </span>
      </td>
      <td
        className={cn(
          "px-2 text-right font-heading font-semibold tabular-nums whitespace-nowrap",
          AMOUNT_TONE_CLASS[amount.tone],
        )}
      >
        {amount.text}
      </td>
    </tr>
  );
}

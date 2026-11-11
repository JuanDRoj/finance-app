"use client";

import { memo } from "react";
import { AMOUNT_TONE_CLASS } from "@/components/movements/amount-tone";
import { CategoryChip } from "@/components/movements/category-chip";
import { MovementLink } from "@/components/movements/movement-link";
import { focusRing } from "@/components/ui/focus";
import {
  accountAmountView,
  balanceAfterText,
  balanceColumnLabel,
} from "@/lib/core/account-movements";
import type { AccountType } from "@/lib/core/data/accounts";
import type { MovementListItem } from "@/lib/core/data/transactions";
import type { Currency } from "@/lib/core/money";
import {
  describeMovementCategory,
  describeMovementStatusNote,
  describeMovementTitle,
  formatMovementDate,
} from "@/lib/core/movements";
import { cn } from "@/lib/utils";

type AccountMovementsTableProps = {
  items: readonly MovementListItem[];
  /** The account the detail shows: the sign of every amount is told from its point of view. */
  account: Readonly<{ id: string; type: AccountType }>;
  currency: Currency;
  /** The space's day (`todayInTimezone`): a date of another year is written with its year. */
  today?: string;
  /** What a screen reader hears as the name of the table. */
  caption: string;
  className?: string;
};

const HEAD = "px-2 py-2 text-left font-bold";

/**
 * The movements of one account as a table (K-V2-Escritorio, "cuentas"): Fecha, Descripción, Categoría
 * (a chip), Monto and, after each movement, **Saldo** of the account (or **Deuda** for a card). A real
 * `table` with a `caption`, `th scope="col"` and the description as the row's header, in a scroller
 * with a floor of 560 px as the canvas draws it (`overflow-x: auto`, `min-width: 560`).
 *
 * - **Monto** is told from the account's point of view (`accountAmountView`): in a bank or cash
 *   account every amount carries its sign, a transfer by its direction; in a card the amount is read
 *   as debt (a purchase has no sign, a payment received has "−").
 * - **Saldo / Deuda** is the `balance_after_minor` the backend sent for that movement (a card shows
 *   the opposite: the debt). A pending or skipped movement has none and shows a dash. It does not
 *   change with the type filter: the backend counts every movement of the account.
 * - **Open.** The description is a `MovementLink` (bold, as the canvas has it): it opens the panel
 *   "Editar movimiento" (or the read-only detail) over this screen. There is no column of actions.
 * - Fecha is the order (newest first) and is not a button; the table is never sorted by the client.
 * - The category is cut with "…" and the description wraps in two lines; the amount and the balance
 *   never wrap, so only a figure of 16 digits in a narrow card makes the scroller scroll.
 */
export const AccountMovementsTable = memo(function AccountMovementsTable({
  items,
  account,
  currency,
  today,
  caption,
  className,
}: AccountMovementsTableProps) {
  return (
    <div data-slot="account-movements-table" className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-140 border-collapse text-item">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-caption text-muted-foreground">
            <th scope="col" aria-sort="descending" className={cn(HEAD, "pl-0")}>
              Fecha
            </th>
            <th scope="col" className={HEAD}>
              Descripción
            </th>
            <th scope="col" className={HEAD}>
              Categoría
            </th>
            <th scope="col" className={cn(HEAD, "text-right")}>
              Monto
            </th>
            <th scope="col" className={cn(HEAD, "pr-0 text-right")}>
              {balanceColumnLabel(account.type)}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <AccountMovementRow
              key={item.id}
              item={item}
              accountId={account.id}
              accountType={account.type}
              currency={currency}
              today={today}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
});

/**
 * One row. A `memo` on its own, like the one of Movimientos: when a page of "Cargar más" arrives
 * `items` is a new array but the movements already on screen are the same objects (TanStack Query
 * keeps them) and the other props are primitives, so only the new rows render.
 */
const AccountMovementRow = memo(function AccountMovementRow({
  item,
  accountId,
  accountType,
  currency,
  today,
}: Readonly<{
  item: MovementListItem;
  accountId: string;
  accountType: AccountType;
  currency: Currency;
  today?: string;
}>) {
  const title = describeMovementTitle(item);
  const category = describeMovementCategory(item);
  const amount = accountAmountView(item, { id: accountId, type: accountType }, currency);
  const balance = balanceAfterText(item, accountType, currency);
  const status = describeMovementStatusNote(item);
  return (
    <tr
      data-slot="account-movement-row"
      data-type={item.type}
      className="border-t border-border transition-colors hover:bg-primary/10 motion-reduce:transition-none dark:hover:bg-primary/12"
    >
      <td className="h-12 py-0 pr-2 whitespace-nowrap text-muted-foreground">
        {formatMovementDate(item.date, today)}
      </td>
      <th scope="row" className="min-w-44 px-2 py-1.5 text-left font-bold">
        <MovementLink
          movementId={item.id}
          aria-haspopup="dialog"
          className={cn("block max-w-full rounded-sm", focusRing)}
        >
          <span title={title} className="line-clamp-2 wrap-anywhere">
            {title}
          </span>
        </MovementLink>
        {status ? (
          <span className="block text-caption font-semibold text-muted-foreground">{status}</span>
        ) : null}
      </th>
      <td className="px-2">
        <CategoryChip category={category} />
      </td>
      <td
        className={cn(
          "px-2 text-right font-heading font-semibold tabular-nums whitespace-nowrap",
          AMOUNT_TONE_CLASS[amount.tone],
        )}
      >
        {amount.text}
      </td>
      <td className="py-0 pr-0 pl-2 text-right tabular-nums whitespace-nowrap text-muted-foreground">
        {balance ?? (
          <>
            <span aria-hidden>—</span>
            <span className="sr-only">No cuenta para el saldo</span>
          </>
        )}
      </td>
    </tr>
  );
});

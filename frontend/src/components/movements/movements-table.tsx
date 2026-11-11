"use client";

import { ArrowDown, Eye, PencilSimple, Trash } from "@phosphor-icons/react/ssr";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { focusRing } from "@/components/ui/focus";
import type { MovementListItem } from "@/lib/core/data/transactions";
import { describeMovementRowActions } from "@/lib/core/movement-label";
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
import { CategoryChip } from "./category-chip";
import { MovementLink } from "./movement-link";

type MovementsTableProps = {
  items: readonly MovementListItem[];
  currency: Currency;
  /** The space's day (`todayInTimezone`): a date of another year is written with its year. */
  today?: string;
  /** What a screen reader hears as the name of the table. */
  caption?: string;
  /** The screen hides it below 1024 px (`max-lg:hidden`): there the day groups take its place. */
  className?: string;
  /**
   * "Eliminar X" of a row: without it the rows have no delete button (a table that only shows, like
   * the one the Inicio will have). Must be the same function between renders (this is a `memo`). The
   * button is left out of a row the API would refuse to delete (an adjustment, a pending or a
   * skipped movement).
   */
  onRemove?: (item: MovementListItem) => void;
  /** The ids being deleted now: their "Eliminar" is busy. A new `Set` re-renders the rows, which is what a delete needs. */
  pendingIds?: ReadonlySet<string>;
  /**
   * The ids of the archived accounts of the space (`archivedAccountIdsOf` of the list with its archived
   * ones). A movement of one of them opens read only and cannot be deleted, as the sheet decides, so its
   * row says "Ver X" and has no "Eliminar X". Memoize it: it is a prop of a `memo`. Without it (the
   * list did not load) every confirmed expense, income and transfer offers both.
   */
  archivedAccountIds?: ReadonlySet<string>;
};

const HEAD = "px-2 py-2.5 text-left font-bold";

// The actions of a row (docs/diseno.md D17 › Escritorio v2): 36 px with a mouse, 44 with a finger,
// at `muted-foreground` at full strength (the canvas draws them at 55 %, which would not reach the 3:1
// of a control's icon). The table only shows from 1024 px, so `size-9` is the base.
const ACTION = cn(
  buttonVariants({ variant: "ghost", size: "icon" }),
  "size-9 text-muted-foreground pointer-coarse:size-11",
);

// "Acciones" stays at the right edge when the table scrolls (between 1024 and about 1180 px, the
// card is narrower than the columns): the buttons are always in reach. It needs a solid background
// (the card's) to cover what scrolls under it; the tint of the hovered row is drawn over it.
const STICKY_END = "sticky right-0 w-21 bg-surface";

/**
 * The movements as a table, from 1024 px (docs/diseno.md D17 › Escritorio v2; K-V2-Escritorio,
 * "movimientos"): Fecha, Descripción, Categoría, Cuenta and Monto, in rows of 48 px with Karla 15.
 * A real `table`: a caption for its name, `th scope="col"` for the columns and the description as
 * the row's header.
 *
 * - **Order.** The backend only sorts by date, newest first, so Fecha carries `aria-sort="descending"`
 *   and is not a button; Monto is not sortable (the canvas draws both as sort buttons: that needs
 *   `sort` in `GET /transactions`, which does not exist yet).
 * - **Open and delete** (FE-23, KAN-83). The description is a `MovementLink` (bold, as the canvas has
 *   it); the last column, "Acciones" (named for assistive technology only, 84 px), has "Editar X" (a
 *   pencil) or "Ver X" (an eye, for an adjustment, a pending or a skipped movement, which cannot be
 *   edited, or one of an archived account: the same rule as the sheet, `movementDetailKindIn`) and, if
 *   the movement can be deleted and `onRemove` is given, "Eliminar X" (a trash can, busy while it
 *   deletes). The names come from `describeMovementRowActions`. The row is tinted under
 *   a mouse (the `sel` of the canvas). The whole text of the table is still the same: the column only
 *   adds 84 px to it.
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
  onRemove,
  pendingIds,
  archivedAccountIds,
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
            <th scope="col" className={cn(STICKY_END, "p-0")}>
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <MovementTableRow
              key={item.id}
              item={item}
              currency={currency}
              today={today}
              onRemove={onRemove}
              pending={pendingIds?.has(item.id) === true}
              archivedAccountIds={archivedAccountIds}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
});

/**
 * One row. A `memo` on its own: when a page of "Cargar más" arrives, `items` is a new array but the
 * movements already on screen are the same objects (TanStack Query keeps them), and so are the other
 * props (`pending` is a boolean, the rest are stable), so only the new rows render. With 500 loaded,
 * that is the difference between 50 rows and 500 on each page.
 */
const MovementTableRow = memo(function MovementTableRow({
  item,
  currency,
  today,
  onRemove,
  pending,
  archivedAccountIds,
}: Readonly<{
  item: MovementListItem;
  currency: Currency;
  today?: string;
  onRemove?: (item: MovementListItem) => void;
  pending: boolean;
  archivedAccountIds?: ReadonlySet<string>;
}>) {
  const title = describeMovementTitle(item);
  const category = describeMovementCategory(item);
  const account = describeMovementAccount(item);
  const amount = movementAmountView(item, currency);
  const status = describeMovementStatusNote(item);
  const actions = describeMovementRowActions(item, archivedAccountIds);
  return (
    <tr
      data-slot="movement-row"
      data-type={item.type}
      className="group border-t border-border transition-colors hover:bg-primary/10 motion-reduce:transition-none dark:hover:bg-primary/12"
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
      <td
        className={cn(
          STICKY_END,
          "py-0 pr-0 pl-1 text-right whitespace-nowrap",
          "after:pointer-events-none after:absolute after:inset-0 after:bg-primary/10 after:opacity-0 group-hover:after:opacity-100 dark:after:bg-primary/12",
        )}
      >
        <span className="inline-flex items-center gap-0.5">
          <MovementLink
            movementId={item.id}
            aria-haspopup="dialog"
            aria-label={actions.open.label}
            className={ACTION}
          >
            {actions.open.kind === "edit" ? <PencilSimple aria-hidden /> : <Eye aria-hidden />}
          </MovementLink>
          {actions.remove && onRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={actions.remove.label}
              loading={pending}
              onClick={() => onRemove(item)}
              className={ACTION}
            >
              {pending ? null : <Trash aria-hidden />}
            </Button>
          ) : null}
        </span>
      </td>
    </tr>
  );
});

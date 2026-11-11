import { memo } from "react";
import type { MovementListItem } from "@/lib/core/data/transactions";
import {
  describeMovementSubline,
  describeMovementTitle,
  movementAmountView,
} from "@/lib/core/movements";
import type { Currency } from "@/lib/core/money";
import { cn } from "@/lib/utils";
import { AMOUNT_TONE_CLASS } from "./amount-tone";
import { MovementIcon } from "./movement-icon";
import { MovementLink } from "./movement-link";

/**
 * A movement in the list of a phone (docs/diseno.md D19; K-H1-Movimientos): the icon, the
 * description (or the category if it has none) and, under it, "Supermercado · Visa Itaú", with the
 * amount on the right. 64 px; a `li` of the `ul` of its day (`MovementDayGroup`).
 *
 * **The whole row is one link** (FE-23, KAN-83), as the canvas draws it (an `<a>` of 64 px): it
 * opens the movement (`MovementLink`: "Editar movimiento", or the read-only detail of an adjustment, a
 * pending or a skipped one; the sheet decides). Its accessible name is its content (title, line and
 * amount), which is what the row said before it was a link, plus `aria-haspopup="dialog"`. It is the
 * only tab stop of the row. The focus ring is drawn **inside** the link: the card of the day cuts
 * what overflows it (`overflow-hidden`), and an outer ring would be cut on three sides. Pressing it
 * tints the row at once (`active:`), a mouse over it too (`hover:`, which only compiles for a
 * pointer that can hover). The tint is `primary` at 10 % in the light theme; in the dark one it is
 * the page `background` at 30 %, **not** the green of the table's rows: a green tint over the glass
 * card, with a blob behind, drops the 13 px line under 4.5:1 (3.7:1 at 12 %), and darkening keeps
 * it above 5.9:1 (`tokens.test.ts` measures both).
 *
 * Title and line are one line each and are cut with "…" (the whole text is in `title`); the amount
 * is never cut, but at the largest value the backend takes it may take two lines (at most 60 % of
 * the row) so the text does not vanish.
 *
 * A `memo`: a page of "Cargar más" makes new day groups, but a movement already on screen is the same
 * object (TanStack Query keeps it), so only the new rows render.
 */
export const MovementRow = memo(function MovementRow({
  item,
  currency,
}: Readonly<{ item: MovementListItem; currency: Currency }>) {
  const title = describeMovementTitle(item);
  const subline = describeMovementSubline(item);
  const amount = movementAmountView(item, currency);
  return (
    <li data-slot="movement-row" data-type={item.type}>
      <MovementLink
        movementId={item.id}
        aria-haspopup="dialog"
        className={cn(
          "flex min-h-16 items-center gap-3 px-3.5 py-2 select-none",
          "transition-colors duration-150 ease-out motion-reduce:transition-none",
          "hover:bg-primary/10 active:bg-primary/10 dark:hover:bg-background/30 dark:active:bg-background/30",
          "focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring",
        )}
      >
        <MovementIcon item={item} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span title={title} className="truncate text-item font-bold">
            {title}
          </span>
          <span title={subline} className="truncate text-caption text-muted-foreground">
            {subline}
          </span>
        </span>
        <span
          className={cn(
            "max-w-3/5 shrink-0 text-right font-heading text-item font-semibold tabular-nums wrap-anywhere",
            AMOUNT_TONE_CLASS[amount.tone],
          )}
        >
          {amount.text}
        </span>
      </MovementLink>
    </li>
  );
});

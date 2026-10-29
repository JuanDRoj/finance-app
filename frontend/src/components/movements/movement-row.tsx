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

/**
 * A movement in the list of a phone (docs/diseno.md D19; K-H1-Movimientos): the icon, the
 * description (or the category if it has none) and, under it, "Supermercado · Visa Itaú", with the
 * amount on the right. 64 px; a `li` of the `ul` of its day (`MovementDayGroup`).
 *
 * **Read only** (FE-22): a row has no link and no button. Editing, deleting and the detail of an
 * adjustment are FE-23's, which makes the row open them. Title and line are one line each and are
 * cut with "…" (the whole text is in `title`); the amount is never cut, but at the largest value
 * the backend takes it may take two lines (at most 60 % of the row) so the text does not vanish.
 */
export function MovementRow({
  item,
  currency,
}: Readonly<{ item: MovementListItem; currency: Currency }>) {
  const title = describeMovementTitle(item);
  const subline = describeMovementSubline(item);
  const amount = movementAmountView(item, currency);
  return (
    <li
      data-slot="movement-row"
      data-type={item.type}
      className="flex min-h-16 items-center gap-3 px-3.5 py-2"
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
    </li>
  );
}

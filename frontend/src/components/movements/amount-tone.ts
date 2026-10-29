import type { AmountTone } from "@/lib/core/movements";

/**
 * The text color of each tone of an amount (docs/diseno.md D19): the income in `income`, an
 * expense in the text color, and the quiet ones (a transfer, an adjustment) in `muted-foreground`.
 * The tone itself comes from `movementAmountView` and `summaryFigures`.
 */
export const AMOUNT_TONE_CLASS: Readonly<Record<AmountTone, string>> = {
  income: "text-income",
  default: "text-foreground",
  muted: "text-muted-foreground",
};

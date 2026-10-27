import type { MovementCreate } from "./data/transactions";
import { TRANSACTION_TYPE_NAMES } from "./i18n";

/**
 * The most a toast says of a movement: a description may be 200 characters, and a toast that long
 * covers the screen. 40 code points, the ellipsis included.
 */
export const TOAST_LABEL_MAX_LENGTH = 40;

/** Cuts `text` to `max` code points (an emoji counts one), ending with "…" when it had to cut. */
export function truncateLabel(text: string, max: number = TOAST_LABEL_MAX_LENGTH): string {
  const characters = [...text];
  if (characters.length <= max) return text;
  return `${characters
    .slice(0, max - 1)
    .join("")
    .trimEnd()}…`;
}

/** The names the label may need: the chosen category's own, and the accounts by id. */
export type MovementNames = {
  /** The name of the category of an expense or an income (`categoryNameOf`). */
  category?: string | null;
  accountNames: ReadonlyMap<string, string>;
};

/**
 * What the toast of a registered movement calls it (docs/diseno.md D19: "Registraste «…»"): the
 * description if it has one, otherwise the category of an expense or an income, and the accounts
 * of a transfer ("Itaú → Visa Itaú", as the list of movements writes it). If a name is missing the
 * type of movement stands in ("Gasto", "Transferencia"), so the toast never says "undefined" nor
 * shows an id. Cut to `TOAST_LABEL_MAX_LENGTH`.
 */
export function describeRegisteredMovement(body: MovementCreate, names: MovementNames): string {
  const description = body.description?.trim();
  if (description) return truncateLabel(description);
  if (body.type === "transfer") {
    const from = names.accountNames.get(body.from_account_id);
    const to = names.accountNames.get(body.to_account_id);
    return truncateLabel(from && to ? `${from} → ${to}` : TRANSACTION_TYPE_NAMES.transfer);
  }
  return truncateLabel(names.category?.trim() || TRANSACTION_TYPE_NAMES[body.type]);
}

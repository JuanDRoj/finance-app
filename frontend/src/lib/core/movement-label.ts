import type { MovementCreate } from "./data/transactions";
import { TRANSACTION_TYPE_NAMES } from "./i18n";
import { describeMovementTitle, isMovementEditable, type MovementLike } from "./movements";

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

/**
 * What a toast calls a movement that is already saved (docs/diseno.md D8, D19): "Eliminaste «Café»",
 * "Guardaste los cambios de «Uber»". Its description, or its category, or "Itaú → Visa Itaú" for a
 * transfer (`describeMovementTitle`, the title the list shows), cut to `TOAST_LABEL_MAX_LENGTH`.
 */
export function describeMovementLabel(movement: MovementLike): string {
  return truncateLabel(describeMovementTitle(movement));
}

/** The names of the two actions a row of the table can have, by the movement it is on. */
export type MovementRowActions = {
  /**
   * What opening the row does and its name: "Editar Uber" for a movement the API lets change, "Ver
   * Ajuste de saldo" for one it does not (an adjustment, a pending or a skipped one: D19, "la acción
   * de la fila de un ajuste se llama «Ver {descripción}»"). The description is cut like a toast's.
   */
  open: { kind: "edit" | "view"; label: string };
  /** "Eliminar Uber"; `null` when the API would refuse to delete it, so the row has no such button. */
  remove: { label: string } | null;
};

/** The names of the actions of the row of a movement (K-V2-Escritorio: `editarLabel` and "Eliminar {desc}"). */
export function describeMovementRowActions(movement: MovementLike): MovementRowActions {
  const label = describeMovementLabel(movement);
  const editable = isMovementEditable(movement);
  return {
    open: editable
      ? { kind: "edit", label: `Editar ${label}` }
      : { kind: "view", label: `Ver ${label}` },
    remove: editable ? { label: `Eliminar ${label}` } : null,
  };
}

import { z } from "zod";
import type { components } from "@/lib/api/schema";
import { parseMoneyInput, type MoneyInputIssue } from "../money";

type MoneyIssueContext = {
  /** Exponent of the space's currency: how many decimals the field accepts. */
  exponent: number;
  /** The amount is a debt the person writes as a positive number (a credit card). */
  debt?: boolean;
};

/** What a decimal amount looks like in this currency, to show a person how to write it. */
function exampleAmount(exponent: number): string {
  return exponent === 0 ? "1550" : `1550,${"50".padEnd(exponent, "0").slice(0, exponent)}`;
}

/**
 * Spanish text under a money field for each reason `parseMoneyInput` can refuse a text. Shared by
 * every form with an amount (the account's balance now; the reconciliation and the movements
 * later), so the wording is the same everywhere.
 */
export function describeMoneyInputIssue(
  issue: MoneyInputIssue,
  { exponent, debt = false }: MoneyIssueContext,
): string {
  switch (issue) {
    case "empty":
      return "Escribe un monto.";
    case "invalid":
      return `Escribe solo números, por ejemplo ${exampleAmount(exponent)}.`;
    case "too_many_decimals":
      if (exponent === 0) return "Esta moneda no usa decimales.";
      return `Usa como máximo ${exponent} ${exponent === 1 ? "decimal" : "decimales"}.`;
    case "negative_not_allowed":
      return debt ? "Escribe la deuda en positivo, sin signo." : "Escribe el monto sin signo.";
    case "too_large":
      return "El monto es demasiado grande.";
  }
}

/**
 * Under the amount field of a movement when it is zero. The backend refuses it too (`amount_minor`
 * is `exclusiveMinimum: 0`). It lives in the schema, not in `parseMoneyInput`, because a balance
 * (an account's opening balance, a reconciliation) may be zero and shares that parser.
 */
export const AMOUNT_NOT_POSITIVE = "El monto debe ser mayor que 0.";

/**
 * Schema of an amount a person types for a movement (an expense, an income or a transfer): the text
 * of the field in, the **integer in the minor unit** of the currency out (`"1550,50"` with exponent
 * 2 -> `155050`), ready for `amount_minor`.
 *
 * - **Greater than zero.** The backend applies the sign according to the type of movement, so a
 *   minus is refused ("Escribe el monto sin signo.") and so is zero (`AMOUNT_NOT_POSITIVE`).
 * - **At most `exponent` decimals.** More is an error, never a rounding. "," and "." both are the
 *   decimal separator and there is no thousands separator: "1.234" is three decimals, never
 *   1234 (docs/diseno.md D11 and D18). For exponent 0 not even one decimal is accepted.
 * - **A safe integer.** Up to `Number.MAX_SAFE_INTEGER`, the cap of the backend.
 *
 * `exponent` is the one of the space's currency (`SpaceRead.currency.exponent`). Everything goes
 * through integers and strings (see `parseMoneyInput`): never a float. The messages are the Spanish
 * text under the field, the same ones `describeMoneyInputIssue` gives every form with an amount.
 * Each field keeps its own `transform`, so an object schema reports an amount error together with
 * the errors of its other fields.
 */
export function moneyAmountSchema(exponent: number) {
  return z.string({ error: "Escribe un monto." }).transform((text, context): number => {
    const parsed = parseMoneyInput(text, exponent);
    if (parsed.ok && parsed.minor > 0) return parsed.minor;
    context.issues.push({
      code: "custom",
      input: text,
      message: parsed.ok
        ? AMOUNT_NOT_POSITIVE
        : describeMoneyInputIssue(parsed.issue, { exponent }),
    });
    return z.NEVER;
  });
}

// Contract check (frontend/CLAUDE.md > Formularios). The field holds text and the schema outputs
// the minor-unit integer, so what must match the generated types is the **output**: the
// `amount_minor` of the three kinds of movement the backend creates.
type MoneyAmount = z.output<ReturnType<typeof moneyAmountSchema>>;
const _checkExpense: components["schemas"]["ExpenseCreate"]["amount_minor"] = 0 as MoneyAmount;
const _checkIncome: components["schemas"]["IncomeCreate"]["amount_minor"] = 0 as MoneyAmount;
const _checkTransfer: components["schemas"]["TransferCreate"]["amount_minor"] = 0 as MoneyAmount;
void [_checkExpense, _checkIncome, _checkTransfer];

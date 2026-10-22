import type { MoneyInputIssue } from "../money";

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

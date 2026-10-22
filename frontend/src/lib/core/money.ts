import type { components } from "@/lib/api/schema";
import { localeForCurrency } from "./locale";

/** Currency of a space as the API sends it: ISO 4217 code and its exponent. */
export type Currency = Pick<components["schemas"]["CurrencyRead"], "code" | "exponent">;

/**
 * Which signs to print: `auto` only the minus of negative amounts, `exceptZero` also "+" on
 * positive ones, `never` none. Zero never carries a sign.
 */
export type MoneySign = "auto" | "exceptZero" | "never";

/** Minor-unit amount as it travels in the API: an integer (safe `number`, `bigint` or digits). */
export type MinorAmount = number | bigint | string;

export type FormatMoneyOptions = {
  sign?: MoneySign;
  /** Overrides the locale derived from the currency. */
  locale?: string;
};

const MINUS_SIGN = "\u2212"; // typographic minus (U+2212); Intl emits an ASCII hyphen
const MAX_EXPONENT = 20;

function assertExponent(exponent: number): void {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > MAX_EXPONENT) {
    throw new RangeError(`Invalid currency exponent: ${exponent}`);
  }
}

function toBigInt(minor: MinorAmount): bigint {
  if (typeof minor === "bigint") return minor;
  if (typeof minor === "number") {
    if (!Number.isSafeInteger(minor)) {
      throw new RangeError(
        `Amount must be a safe integer in minor units (use a string or bigint for larger values): ${minor}`,
      );
    }
    return BigInt(minor);
  }
  if (!/^-?\d+$/.test(minor)) {
    throw new RangeError(`Amount must be an integer in minor units: "${minor}"`);
  }
  return BigInt(minor);
}

/**
 * Minor units to an exact decimal string using integer and string operations only
 * (`155050`, exponent 2 -> `"1550.50"`). Never divides, so there is no float rounding.
 */
export function minorToDecimalString(minor: MinorAmount, exponent: number): string {
  assertExponent(exponent);
  const value = toBigInt(minor);
  const negative = value < BigInt(0);
  const digits = (negative ? -value : value).toString().padStart(exponent + 1, "0");
  const integer = digits.slice(0, digits.length - exponent);
  const fraction = exponent > 0 ? `.${digits.slice(digits.length - exponent)}` : "";
  return `${negative ? "-" : ""}${integer}${fraction}`;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(
  locale: string,
  currency: Currency,
  signDisplay: "auto" | "exceptZero" | "never",
): Intl.NumberFormat {
  const key = `${locale}|${currency.code}|${currency.exponent}|${signDisplay}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency.code,
      // Always exactly `exponent` decimals: what is shown is what is stored.
      minimumFractionDigits: currency.exponent,
      maximumFractionDigits: currency.exponent,
      // Thousands are always separated: es-ES (the euro) would skip it in "1234,50 €".
      useGrouping: "always",
      signDisplay,
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

/**
 * Formats a minor-unit amount for display, e.g. `155050` UYU -> `$ 1.550,50`, an expense
 * `-155050` -> `−$ 1.550,50` (typographic minus, U+2212).
 *
 * Display only: never do arithmetic on the result, and never with floats on the input.
 */
export function formatMoney(
  minor: MinorAmount,
  currency: Currency,
  options: FormatMoneyOptions = {},
): string {
  const { sign = "auto", locale = localeForCurrency(currency.code) } = options;
  const decimal = minorToDecimalString(minor, currency.exponent);
  const isZero = toBigInt(minor) === BigInt(0);
  const formatter = formatterFor(locale, currency, isZero ? "never" : sign);
  // Intl formats exact decimal strings (ES2023); the DOM lib types only know number | bigint.
  return formatter
    .formatToParts(decimal as Intl.StringNumericLiteral)
    .map((part) => (part.type === "minusSign" ? MINUS_SIGN : part.value))
    .join("");
}

/**
 * The symbol people write before an amount of this currency, taken from the same formatter that
 * prints it: "$" for the pesos, "US$", "R$", "€", or the ISO code of a currency Intl does not know
 * by symbol. It is the prefix of the money field (docs/diseno.md D18: no "$" is ever fixed).
 */
export function currencySymbolOf(currency: Currency): string {
  const parts = formatterFor(localeForCurrency(currency.code), currency, "never").formatToParts(0);
  return parts.find((part) => part.type === "currency")?.value ?? currency.code;
}

/** Why `parseMoneyInput` refused a text; the form maps each one to its Spanish message. */
export type MoneyInputIssue =
  "empty" | "invalid" | "too_many_decimals" | "negative_not_allowed" | "too_large";

export type ParsedMoney = { ok: true; minor: number } | { ok: false; issue: MoneyInputIssue };

export type ParseMoneyOptions = {
  /** A leading minus ("-" or the typographic "−") is accepted. Default: it is an error. */
  allowNegative?: boolean;
};

// An optional minus, digits, and at most one decimal separator ("," or "."). No thousands
// separator: "1.550" is 1,55 pesos with three decimals (an error for exponent 2), not 1550.
const MONEY_INPUT = /^(-|\u2212)?(\d*)(?:[.,](\d*))?$/;

/**
 * Turns what a person typed into an amount in the minor unit of the currency ("0,29" with
 * exponent 2 -> 29), using integers and strings only: never a float, so 0,29 is never
 * 28.999999999999996. At most `exponent` decimals (what is shown is what is stored); more is an
 * error, not a rounding. The result is a safe integer, the same cap as the backend
 * (`MAX_SAFE_INTEGER`), and zero never carries a sign. An empty text is `empty`, so the form can
 * decide whether an empty amount means "none" (an optional balance) or "required".
 */
export function parseMoneyInput(
  text: string,
  exponent: number,
  { allowNegative = false }: ParseMoneyOptions = {},
): ParsedMoney {
  assertExponent(exponent);
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, issue: "empty" };

  const match = MONEY_INPUT.exec(trimmed);
  const [, minus, integerPart = "", fractionPart = ""] = match ?? [];
  if (!match || (integerPart === "" && fractionPart === "")) return { ok: false, issue: "invalid" };
  if (minus && !allowNegative) return { ok: false, issue: "negative_not_allowed" };
  if (fractionPart.length > exponent) return { ok: false, issue: "too_many_decimals" };

  const magnitude = BigInt(`${integerPart || "0"}${fractionPart.padEnd(exponent, "0")}`);
  if (magnitude > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, issue: "too_large" };
  const value = Number(magnitude);
  return { ok: true, minor: minus && value !== 0 ? -value : value };
}

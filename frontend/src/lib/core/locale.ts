/**
 * Locale used to format money and dates. It comes from the space's currency, never from the
 * device: the same amount must read the same on every phone, and the server cannot know the
 * device locale (a hydration mismatch waiting to happen).
 */
export const DEFAULT_LOCALE = "es-UY";

const CURRENCY_LOCALES: Readonly<Record<string, string>> = {
  UYU: "es-UY",
  COP: "es-CO",
  USD: "es-UY",
};

export function localeForCurrency(currencyCode: string): string {
  return CURRENCY_LOCALES[currencyCode] ?? DEFAULT_LOCALE;
}

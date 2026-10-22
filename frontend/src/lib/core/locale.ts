/**
 * Locale used to format money and dates. It comes from the space's currency, never from the
 * device: the same amount must read the same on every phone, and the server cannot know the
 * device locale (a hydration mismatch waiting to happen).
 */
export const DEFAULT_LOCALE = "es-UY";

/**
 * The six currencies the backend seeds (docs/diseno.md D11), each with the locale that writes its
 * amounts the way people who use it read them: "$ 1.234,50" for the pesos, "US$ 1.234,50" for the
 * dollar, "R$ 1.234,50" for the real and "1.234,50 €" for the euro. Anything else falls back to
 * `DEFAULT_LOCALE` and shows its ISO code ("CLP 1.500").
 *
 * This is for **money only**. The interface is in Spanish, so dates and every other text keep
 * `DEFAULT_LOCALE` (`dates.ts` never reads this map): a space in reales must not show months in
 * Portuguese. `money.ts` groups thousands always (`useGrouping: "always"`) because es-ES, the
 * locale of the euro, skips the separator in four-digit numbers ("1234,50 €").
 */
const CURRENCY_LOCALES: Readonly<Record<string, string>> = {
  UYU: "es-UY",
  COP: "es-CO",
  USD: "es-UY",
  ARS: "es-AR",
  BRL: "pt-BR",
  EUR: "es-ES",
};

export function localeForCurrency(currencyCode: string): string {
  return Object.hasOwn(CURRENCY_LOCALES, currencyCode)
    ? (CURRENCY_LOCALES[currencyCode] ?? DEFAULT_LOCALE)
    : DEFAULT_LOCALE;
}

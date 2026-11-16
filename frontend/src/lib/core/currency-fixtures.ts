/**
 * The currencies the backend seeds and their ISO 4217 exponent, for the **tests** (never imported by
 * the app or the catalog): a copy of `SEED` in
 * `backend/migrations/versions/20261005_0001_create_currencies.py`, which the backend checks too in
 * `backend/tests/db/test_currencies_migration.py`. `GET /currencies` sends only the code and the
 * exponent, and `openapi.json` publishes `code` as a plain string (no enum), so there is no
 * generated type to compare against: this list is the one to touch when the backend seeds another
 * currency (a data migration). `currencies.test.ts` then fails until the new code has a name in
 * `CURRENCY_NAMES` (i18n.ts) and a locale in `CURRENCY_LOCALES` (locale.ts): without them the picker
 * would list it as a bare code and its amounts would read "XXX 1.500" (KAN-103, found on a phone).
 *
 * It is the one place where the tests read the exponent of a seeded currency, so no test repeats the
 * rule "CLP and PYG have 0, the rest 2". The order is the seed's, which is the order of the list the
 * person picks from.
 */
export const SEEDED_CURRENCIES = {
  UYU: 2,
  COP: 2,
  USD: 2,
  ARS: 2,
  BRL: 2,
  EUR: 2,
  CLP: 0,
  PYG: 0,
} as const satisfies Record<string, number>;

/** A code the backend seeds. */
export type SeededCurrencyCode = keyof typeof SEEDED_CURRENCIES;

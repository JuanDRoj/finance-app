import { describe, expect, it } from "vitest";
import { CURRENCY_NAMES, describeCurrency, orderCurrencies } from "./i18n";
import { CURRENCY_LOCALES, localeForCurrency } from "./locale";
import { currencySymbolOf, formatMoney } from "./money";

// The currencies the backend seeds and their ISO 4217 exponent: a copy of `SEED` in
// `backend/migrations/versions/20261005_0001_create_currencies.py` (the backend checks it too, in
// `backend/tests/db/test_currencies_migration.py`). `GET /currencies` sends only the code and the
// exponent, and `openapi.json` publishes `code` as a plain string (no enum), so there is no
// generated type to compare against: this list is the one to touch when the backend seeds another
// currency (a data migration). The test then fails until the new code has a name in
// `CURRENCY_NAMES` (i18n.ts) and a locale in `CURRENCY_LOCALES` (locale.ts): without them the picker
// would list it as a bare code and its amounts would read "XXX 1.500" (KAN-103, found on a phone).
const SEEDED_CURRENCIES = {
  UYU: 2,
  COP: 2,
  USD: 2,
  ARS: 2,
  BRL: 2,
  EUR: 2,
  CLP: 0,
  PYG: 0,
} as const satisfies Record<string, number>;

const SEEDED = Object.entries(SEEDED_CURRENCIES);

describe("every currency the backend seeds has its name and its way of writing amounts", () => {
  it("lists eight currencies, as the backend seeds them", () => {
    expect(SEEDED).toHaveLength(8);
  });

  it.each(SEEDED)("%s has a name in Spanish, different from its code", (code) => {
    expect(Object.hasOwn(CURRENCY_NAMES, code)).toBe(true);
    const name = CURRENCY_NAMES[code];
    expect(name).toBeTruthy();
    expect(name).not.toBe(code);
    expect(describeCurrency(code)).toBe(`${name} · ${code}`);
  });

  it.each(SEEDED)("%s has a locale of its own (not the fallback by omission)", (code) => {
    expect(Object.hasOwn(CURRENCY_LOCALES, code)).toBe(true);
    expect(localeForCurrency(code)).toBe(CURRENCY_LOCALES[code]);
  });

  it.each(SEEDED)("%s is written with a symbol, never with its ISO code", (code, exponent) => {
    expect(currencySymbolOf({ code, exponent })).not.toBe(code);
    const amount = formatMoney(155050, { code, exponent });
    expect(amount).not.toContain(code);
    // The sign too: a negative amount keeps the symbol, whatever the locale does with the minus.
    expect(formatMoney(-155050, { code, exponent })).not.toContain(code);
  });

  it.each(SEEDED)("%s shows exactly its exponent in decimals", (code, exponent) => {
    // 1.234 major units, written in the minor unit of the currency.
    const minor = BigInt(1234) * BigInt(10) ** BigInt(exponent);
    const amount = formatMoney(minor, { code, exponent });
    const decimals = /,(\d+)(?!\d)/.exec(amount)?.[1] ?? "";
    expect(decimals).toHaveLength(exponent);
  });

  it("keeps the name map and the locale map on the same currencies, with no strays", () => {
    const seeded = Object.keys(SEEDED_CURRENCIES).sort();
    expect(Object.keys(CURRENCY_NAMES).sort()).toEqual(seeded);
    expect(Object.keys(CURRENCY_LOCALES).sort()).toEqual(seeded);
  });

  it("lists them in the order of the list the person picks from, the one of the backend's seed", () => {
    const fromBackend = Object.keys(SEEDED_CURRENCIES)
      .reverse()
      .map((code) => ({ code }));
    expect(orderCurrencies(fromBackend).map(({ code }) => code)).toEqual(
      Object.keys(SEEDED_CURRENCIES),
    );
  });
});

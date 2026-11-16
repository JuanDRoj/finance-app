import { describe, expect, it } from "vitest";
import { SEEDED_CURRENCIES } from "./currency-fixtures";
import { CURRENCY_NAMES, describeCurrency, orderCurrencies } from "./i18n";
import { CURRENCY_LOCALES, localeForCurrency } from "./locale";
import { currencySymbolOf, formatMoney } from "./money";

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

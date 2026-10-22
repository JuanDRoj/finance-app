import { describe, expect, it } from "vitest";
import { formatInstant, formatLocalDate } from "./dates";
import { DEFAULT_LOCALE, localeForCurrency } from "./locale";
import { formatMoney } from "./money";

// Intl puts a no-break space (U+00A0) between the symbol and the digits.
const NBSP = " ";

const SEEDED = [
  ["UYU", "es-UY"],
  ["COP", "es-CO"],
  ["USD", "es-UY"],
  ["ARS", "es-AR"],
  ["BRL", "pt-BR"],
  ["EUR", "es-ES"],
] as const;

describe("localeForCurrency", () => {
  it.each(SEEDED)("maps %s to %s", (code, locale) => {
    expect(localeForCurrency(code)).toBe(locale);
  });

  it("falls back to es-UY for a currency that is not seeded", () => {
    expect(localeForCurrency("JPY")).toBe(DEFAULT_LOCALE);
    expect(DEFAULT_LOCALE).toBe("es-UY");
  });

  it("does not take object keys for currencies", () => {
    expect(localeForCurrency("constructor")).toBe(DEFAULT_LOCALE);
    expect(localeForCurrency("toString")).toBe(DEFAULT_LOCALE);
    expect(localeForCurrency("__proto__")).toBe(DEFAULT_LOCALE);
  });
});

describe("the six seeded currencies, written", () => {
  const amounts: [string, string, string][] = [
    // [code, 1.234,50 as minor units, what the user reads]
    ["UYU", "123450", `$${NBSP}1.234,50`],
    ["COP", "123450", `$${NBSP}1.234,50`],
    ["USD", "123450", `US$${NBSP}1.234,50`],
    ["ARS", "123450", `$${NBSP}1.234,50`],
    ["BRL", "123450", `R$${NBSP}1.234,50`],
    // The euro goes after the amount, and a four-digit amount still has its thousands separator.
    ["EUR", "123450", `1.234,50${NBSP}€`],
  ];

  it.each(amounts)("%s %s -> %s", (code, minor, text) => {
    expect(formatMoney(minor, { code, exponent: 2 })).toBe(text);
  });

  it("groups four-digit amounts in every locale (es-ES alone would not)", () => {
    expect(formatMoney(100000, { code: "EUR", exponent: 2 })).toBe(`1.000,00${NBSP}€`);
    expect(formatMoney(100000, { code: "BRL", exponent: 2 })).toBe(`R$${NBSP}1.000,00`);
  });

  it("keeps the typographic minus on the euro and the real", () => {
    expect(formatMoney(-123450, { code: "EUR", exponent: 2 })).toBe(`−1.234,50${NBSP}€`);
    expect(formatMoney(-123450, { code: "BRL", exponent: 2 })).toBe(`−R$${NBSP}1.234,50`);
  });
});

describe("dates stay in Spanish (es-UY) whatever the currency", () => {
  it("never reads the currency locale: a space in reales still gets Spanish months", () => {
    expect(localeForCurrency("BRL")).toBe("pt-BR");
    expect(formatLocalDate("2026-10-15", "long")).toBe("15 de octubre de 2026");
    expect(formatInstant("2026-10-15T12:00:00Z", "America/Sao_Paulo", "long")).toBe(
      "15 de octubre de 2026",
    );
  });
});

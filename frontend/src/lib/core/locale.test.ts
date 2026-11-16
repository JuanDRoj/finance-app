import { describe, expect, it } from "vitest";
import { formatInstant, formatLocalDate } from "./dates";
import { DEFAULT_LOCALE, localeForCurrency } from "./locale";
import { formatMoney } from "./money";

// Intl writes an ASCII hyphen; `formatMoney` swaps it for the typographic minus (U+2212).
const MINUS = "−";

// Intl puts a no-break space (U+00A0) between the symbol and the digits.
const NBSP = " ";

const SEEDED = [
  ["UYU", "es-UY"],
  ["COP", "es-CO"],
  ["USD", "es-UY"],
  ["ARS", "es-AR"],
  ["BRL", "pt-BR"],
  ["EUR", "es-ES"],
  ["CLP", "es-CL"],
  ["PYG", "es-PY"],
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

describe("the eight seeded currencies, written", () => {
  const amounts: [string, number, string, string][] = [
    // [code, exponent, 1.234,50 (or 1.234) as minor units, what the user reads]
    ["UYU", 2, "123450", `$${NBSP}1.234,50`],
    ["COP", 2, "123450", `$${NBSP}1.234,50`],
    ["USD", 2, "123450", `US$${NBSP}1.234,50`],
    ["ARS", 2, "123450", `$${NBSP}1.234,50`],
    ["BRL", 2, "123450", `R$${NBSP}1.234,50`],
    // The euro goes after the amount, and a four-digit amount still has its thousands separator.
    ["EUR", 2, "123450", `1.234,50${NBSP}€`],
    // CLP and PYG have no decimals (exponent 0). The Chilean peso has no space after its "$"; the
    // guaraní writes "Gs." and a no-break space, like the pesos of the Río de la Plata.
    ["CLP", 0, "1234", "$1.234"],
    ["PYG", 0, "1234", `Gs.${NBSP}1.234`],
  ];

  it.each(amounts)("%s (exponent %s) %s -> %s", (code, exponent, minor, text) => {
    expect(formatMoney(minor, { code, exponent })).toBe(text);
  });

  it("groups four-digit amounts in every locale (es-ES alone would not)", () => {
    expect(formatMoney(100000, { code: "EUR", exponent: 2 })).toBe(`1.000,00${NBSP}€`);
    expect(formatMoney(100000, { code: "BRL", exponent: 2 })).toBe(`R$${NBSP}1.000,00`);
    expect(formatMoney(1000, { code: "CLP", exponent: 0 })).toBe("$1.000");
    expect(formatMoney(1000, { code: "PYG", exponent: 0 })).toBe(`Gs.${NBSP}1.000`);
  });

  it("keeps the typographic minus on the euro and the real", () => {
    expect(formatMoney(-123450, { code: "EUR", exponent: 2 })).toBe(`−1.234,50${NBSP}€`);
    expect(formatMoney(-123450, { code: "BRL", exponent: 2 })).toBe(`−R$${NBSP}1.234,50`);
  });

  it("never writes the ISO code of a seeded currency: each has its own symbol", () => {
    for (const [code, locale] of SEEDED) {
      const exponent = code === "CLP" || code === "PYG" ? 0 : 2;
      expect(formatMoney(155050, { code, exponent })).not.toContain(code);
      expect(localeForCurrency(code)).toBe(locale);
    }
  });

  // The sign goes where the locale puts it (docs/diseno.md D11): es-CL and es-PY write it **after**
  // the symbol ("$-1.550", "Gs. -1.550"), the other six before it. The typographic minus replaces
  // the hyphen where Intl leaves it, so the order is the locale's own. KAN-103: decided to keep it.
  it("puts the sign of CLP and PYG after the symbol, as es-CL and es-PY write it", () => {
    expect(formatMoney(-1550, { code: "CLP", exponent: 0 })).toBe(`$${MINUS}1.550`);
    expect(formatMoney(1550, { code: "CLP", exponent: 0 }, { sign: "exceptZero" })).toBe("$+1.550");
    expect(formatMoney(-1550, { code: "PYG", exponent: 0 })).toBe(`Gs.${NBSP}${MINUS}1.550`);
    expect(formatMoney(1550, { code: "PYG", exponent: 0 }, { sign: "exceptZero" })).toBe(
      `Gs.${NBSP}+1.550`,
    );
    expect(formatMoney(-1550, { code: "CLP", exponent: 0 }, { sign: "never" })).toBe("$1.550");
  });

  it("keeps the sign before the symbol in the other six", () => {
    expect(formatMoney(-155050, { code: "UYU", exponent: 2 })).toBe(`${MINUS}$${NBSP}1.550,50`);
    expect(formatMoney(155050, { code: "UYU", exponent: 2 }, { sign: "exceptZero" })).toBe(
      `+$${NBSP}1.550,50`,
    );
  });

  it("writes zero without a sign in CLP and PYG too", () => {
    expect(formatMoney(0, { code: "CLP", exponent: 0 }, { sign: "exceptZero" })).toBe("$0");
    expect(formatMoney("-0", { code: "PYG", exponent: 0 }, { sign: "exceptZero" })).toBe(
      `Gs.${NBSP}0`,
    );
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

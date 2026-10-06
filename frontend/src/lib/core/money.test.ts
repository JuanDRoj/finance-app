import { describe, expect, it } from "vitest";
import { localeForCurrency } from "./locale";
import { formatMoney, minorToDecimalString } from "./money";

// Intl puts a no-break space (U+00A0) between symbol and digits, and we print expenses with the
// typographic minus (U+2212). Escapes keep the expectations exact and visible.
const NBSP = " ";
const MINUS = "−";

const UYU = { code: "UYU", exponent: 2 };
const COP = { code: "COP", exponent: 2 };
const USD = { code: "USD", exponent: 2 };
const CLP = { code: "CLP", exponent: 0 };
const KWD = { code: "KWD", exponent: 3 };

describe("minorToDecimalString", () => {
  it("places the decimal point by exponent using integer arithmetic only", () => {
    expect(minorToDecimalString(155050, 2)).toBe("1550.50");
    expect(minorToDecimalString(1500, 0)).toBe("1500");
    expect(minorToDecimalString(1234, 3)).toBe("1.234");
  });

  it("pads amounts smaller than one major unit", () => {
    expect(minorToDecimalString(5, 2)).toBe("0.05");
    expect(minorToDecimalString(0, 2)).toBe("0.00");
    expect(minorToDecimalString(7, 3)).toBe("0.007");
  });

  it("keeps the sign of negative amounts", () => {
    expect(minorToDecimalString(-155050, 2)).toBe("-1550.50");
    expect(minorToDecimalString(-5, 2)).toBe("-0.05");
  });

  it("does not lose precision beyond Number.MAX_SAFE_INTEGER", () => {
    expect(minorToDecimalString("9007199254740993", 2)).toBe("90071992547409.93");
    expect(minorToDecimalString(BigInt("-12345678901234567890"), 2)).toBe("-123456789012345678.90");
  });

  it("never prints negative zero", () => {
    expect(minorToDecimalString("-0", 2)).toBe("0.00");
  });

  it("rejects amounts that are not integers in minor units", () => {
    expect(() => minorToDecimalString(1.5, 2)).toThrow(RangeError);
    expect(() => minorToDecimalString(Number.NaN, 2)).toThrow(RangeError);
    expect(() => minorToDecimalString(2 ** 53, 2)).toThrow(RangeError);
    expect(() => minorToDecimalString("15.50", 2)).toThrow(RangeError);
    expect(() => minorToDecimalString("", 2)).toThrow(RangeError);
    expect(() => minorToDecimalString("abc", 2)).toThrow(RangeError);
  });

  it("rejects an invalid exponent", () => {
    for (const exponent of [-1, 1.5, 21, Number.NaN]) {
      expect(() => minorToDecimalString(100, exponent)).toThrow(RangeError);
    }
  });
});

describe("formatMoney", () => {
  it("formats UYU with es-UY separators and exactly two decimals", () => {
    expect(formatMoney(155050, UYU)).toBe(`$${NBSP}1.550,50`);
    expect(formatMoney(100, UYU)).toBe(`$${NBSP}1,00`);
  });

  it("formats COP with es-CO and keeps the decimals Intl would drop", () => {
    expect(formatMoney(123450, COP)).toBe(`$${NBSP}1.234,50`);
  });

  it("formats USD with es-UY", () => {
    expect(formatMoney(123450, USD)).toBe(`US$${NBSP}1.234,50`);
  });

  it("shows no decimals when the exponent is 0 and shows the code of an unmapped currency", () => {
    expect(formatMoney(1500, CLP)).toBe(`CLP${NBSP}1.500`);
  });

  it("shows exactly three decimals when the exponent is 3", () => {
    expect(formatMoney(1234, KWD)).toBe(`KWD${NBSP}1,234`);
    expect(formatMoney(1000, KWD)).toBe(`KWD${NBSP}1,000`);
  });

  it("prints negative amounts with the typographic minus, not a hyphen", () => {
    const text = formatMoney(-155050, UYU);
    expect(text).toBe(`${MINUS}$${NBSP}1.550,50`);
    expect(text).not.toContain("-");
    expect(formatMoney(-1234, KWD)).toBe(`${MINUS}KWD${NBSP}1,234`);
  });

  it("prints the plus sign only on request", () => {
    expect(formatMoney(155050, UYU)).not.toContain("+");
    expect(formatMoney(155050, UYU, { sign: "exceptZero" })).toBe(`+$${NBSP}1.550,50`);
    expect(formatMoney(-155050, UYU, { sign: "exceptZero" })).toBe(`${MINUS}$${NBSP}1.550,50`);
  });

  it("can hide the sign", () => {
    expect(formatMoney(-155050, UYU, { sign: "never" })).toBe(`$${NBSP}1.550,50`);
  });

  it("formats cents without float rounding", () => {
    expect(formatMoney(5, UYU)).toBe(`$${NBSP}0,05`);
    expect(formatMoney(-5, UYU)).toBe(`${MINUS}$${NBSP}0,05`);
    expect(formatMoney(10, UYU)).toBe(`$${NBSP}0,10`);
    expect(formatMoney(29, UYU)).toBe(`$${NBSP}0,29`);
  });

  it("never signs zero, whatever the sign option", () => {
    for (const sign of ["auto", "exceptZero", "never"] as const) {
      expect(formatMoney(0, UYU, { sign })).toBe(`$${NBSP}0,00`);
      expect(formatMoney("-0", UYU, { sign })).toBe(`$${NBSP}0,00`);
    }
  });

  it("formats huge amounts exactly, from a string or a bigint", () => {
    expect(formatMoney("12345678901234567890", UYU)).toBe(`$${NBSP}123.456.789.012.345.678,90`);
    expect(formatMoney(BigInt("-9007199254740993"), UYU)).toBe(
      `${MINUS}$${NBSP}90.071.992.547.409,93`,
    );
  });

  it("uses the locale of the currency, not the one of the runtime", () => {
    expect(localeForCurrency("COP")).toBe("es-CO");
    expect(localeForCurrency("UYU")).toBe("es-UY");
    expect(localeForCurrency("USD")).toBe("es-UY");
    expect(localeForCurrency("JPY")).toBe("es-UY");
  });

  it("accepts an explicit locale", () => {
    expect(formatMoney(155050, UYU, { locale: "en-US" })).toBe("UYU 1,550.50");
  });

  it("propagates errors for invalid input", () => {
    expect(() => formatMoney(1.5, UYU)).toThrow(RangeError);
    expect(() => formatMoney(100, { code: "UYU", exponent: -1 })).toThrow(RangeError);
  });
});

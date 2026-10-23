import { describe, expect, it } from "vitest";
import { z } from "zod";
import { minorToDecimalString, parseMoneyInput, type MoneyInputIssue } from "../money";
import { AMOUNT_NOT_POSITIVE, describeMoneyInputIssue, moneyAmountSchema } from "./money-input";

// The exponents are the ones the backend seeds (`currencies`, migration 0001): UYU, COP and USD
// have 2 and CLP has 0. The frontend has no table of currencies on purpose (docs/diseno.md D11).
const UYU = { code: "UYU", exponent: 2 };
const COP = { code: "COP", exponent: 2 };
const USD = { code: "USD", exponent: 2 };
const CLP = { code: "CLP", exponent: 0 };

const NBSP = " ";
const MINUS = "−";

/** The minor-unit integer for a text, or the messages the person would read. */
function check(text: unknown, exponent: number) {
  const result = moneyAmountSchema(exponent).safeParse(text);
  if (result.success) return { minor: result.data };
  return { messages: result.error.issues.map((issue) => issue.message) };
}

describe.each([UYU, COP, USD])("moneyAmountSchema: $code (two decimals)", ({ exponent }) => {
  it.each([
    ["1550,50", 155050],
    ["1550.50", 155050],
    ["15", 1500],
    ["15,5", 1550],
    ["0,29", 29],
    ["0,01", 1],
    ["0,07", 7],
    ["1,15", 115],
    ["4.35", 435],
    [",5", 50],
    ["7,", 700],
    ["007", 700],
  ])("turns %s into %i minor units", (text, minor) => {
    expect(check(text, exponent)).toEqual({ minor });
  });

  it("trims the text, the non-breaking space included", () => {
    expect(check(`  15,25${NBSP}`, exponent)).toEqual({ minor: 1525 });
  });

  it("refuses more than two decimals instead of rounding, and 1.234 is three decimals", () => {
    for (const text of ["1,505", "1,500", "1.234", "0,001"]) {
      expect(check(text, exponent), text).toEqual({ messages: ["Usa como máximo 2 decimales."] });
    }
  });

  it("accepts the largest safe integer and refuses the next one", () => {
    // 2^53 - 1 = 9007199254740991 minor units = 90071992547409,91.
    expect(check("90071992547409,91", exponent)).toEqual({ minor: Number.MAX_SAFE_INTEGER });
    expect(check("90071992547409,92", exponent)).toEqual({
      messages: ["El monto es demasiado grande."],
    });
    expect(check("9".repeat(40), exponent)).toEqual({
      messages: ["El monto es demasiado grande."],
    });
  });

  it("gives back the same integer for every amount from 0,01 to 100,00 (no float rounding)", () => {
    // 0,29 * 100 is 28.999999999999996, 1,15 * 100 is 114.99999999999999 and 4,35 * 100 is
    // 434.99999999999994: going through a float would lose a cent on these.
    for (let minor = 1; minor <= 10000; minor += 1) {
      const text = minorToDecimalString(minor, exponent);
      expect(check(text, exponent), text).toEqual({ minor });
    }
  });
});

describe("moneyAmountSchema: CLP (no decimals)", () => {
  const { exponent } = CLP;

  it.each([
    ["1500", 1500],
    ["15", 15],
    ["1", 1],
    ["007", 7],
    ["1500,", 1500],
    ["1500.", 1500],
  ])("turns %s into %i", (text, minor) => {
    expect(check(text, exponent)).toEqual({ minor });
  });

  it("does not accept a single decimal, and 1.500 is not one thousand five hundred", () => {
    for (const text of ["1,5", "1.5", "1.500", "1.234", "1500,0"]) {
      expect(check(text, exponent), text).toEqual({ messages: ["Esta moneda no usa decimales."] });
    }
  });

  it("rejects zero and refuses the example in its own currency", () => {
    expect(check("0", exponent)).toEqual({ messages: [AMOUNT_NOT_POSITIVE] });
    expect(check("abc", exponent)).toEqual({
      messages: ["Escribe solo números, por ejemplo 1550."],
    });
  });

  it("accepts the largest safe integer and refuses the next one", () => {
    expect(check("9007199254740991", exponent)).toEqual({ minor: Number.MAX_SAFE_INTEGER });
    expect(check("9007199254740992", exponent)).toEqual({
      messages: ["El monto es demasiado grande."],
    });
  });

  it("gives back the same integer for the first thousands", () => {
    for (let minor = 1; minor <= 5000; minor += 1) {
      expect(check(String(minor), exponent), String(minor)).toEqual({ minor });
    }
  });
});

describe("moneyAmountSchema: what it refuses, in Spanish", () => {
  it("asks for an amount when there is none", () => {
    for (const value of ["", "   ", `${NBSP}`, undefined, null, 15, 15.5, true]) {
      expect(check(value, 2), String(value)).toEqual({ messages: ["Escribe un monto."] });
    }
  });

  it("requires an amount greater than zero", () => {
    for (const text of ["0", "00", "0,00", "0.00", ",0", "0,", " 0 "]) {
      expect(check(text, 2), text).toEqual({ messages: [AMOUNT_NOT_POSITIVE] });
    }
    expect(AMOUNT_NOT_POSITIVE).toBe("El monto debe ser mayor que 0.");
  });

  it("refuses a minus, the typographic one too: the backend applies the sign", () => {
    for (const text of ["-5", `${MINUS}5`, "-0", "-0,00", "-5,50"]) {
      expect(check(text, 2), text).toEqual({ messages: ["Escribe el monto sin signo."] });
    }
  });

  it("refuses what is not a number, with an example in the currency's own format", () => {
    for (const text of ["abc", "12a", "1,2,3", "1.550,50", "1.234.567", "$ 15", "1 500", "1e3"]) {
      expect(check(text, 2), text).toEqual({
        messages: ["Escribe solo números, por ejemplo 1550,50."],
      });
    }
    for (const text of ["+5", ",", ".", "--5", "١٢"]) {
      expect(check(text, 2), text).toEqual({
        messages: ["Escribe solo números, por ejemplo 1550,50."],
      });
    }
  });

  it("writes the singular for a currency with one decimal", () => {
    expect(check("1,55", 1)).toEqual({ messages: ["Usa como máximo 1 decimal."] });
    expect(check("1,5", 1)).toEqual({ minor: 15 });
  });

  it("reads 1.234 as a decimal number whenever the currency has room for three decimals", () => {
    // Never thousands: with exponent 3 it is one unit and 234 thousandths.
    expect(check("1.234", 3)).toEqual({ minor: 1234 });
    expect(check("1,234", 3)).toEqual({ minor: 1234 });
  });

  it("is a string schema: the form keeps text, the number only comes out", () => {
    const schema = moneyAmountSchema(2);
    expect(schema.parse("1550,50")).toBe(155050);
    // z.input is a string: a number cannot be passed in.
    const input: z.input<typeof schema> = "15";
    expect(input).toBe("15");
    expect(Number.isSafeInteger(schema.parse("0,29"))).toBe(true);
  });
});

describe("moneyAmountSchema: inside an object", () => {
  it("reports the amount together with the other fields, each on its own path", () => {
    const schema = z.object({
      amount: moneyAmountSchema(2),
      description: z.string().min(1, "Escribe una descripción."),
    });
    const result = schema.safeParse({ amount: "1,505", description: "" });
    expect(result.success).toBe(false);
    const messages = Object.fromEntries(
      (result.error?.issues ?? []).map((issue) => [String(issue.path[0]), issue.message]),
    );
    expect(messages).toEqual({
      amount: "Usa como máximo 2 decimales.",
      description: "Escribe una descripción.",
    });
  });

  it("outputs the integer next to the rest of the values", () => {
    const schema = z.object({ amount: moneyAmountSchema(2), description: z.string() });
    expect(schema.parse({ amount: "1550,50", description: "Uber" })).toEqual({
      amount: 155050,
      description: "Uber",
    });
  });

  it("says the amount is required when the form has not set it yet", () => {
    const schema = z.object({ amount: moneyAmountSchema(2) });
    const result = schema.safeParse({});
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(["Escribe un monto."]);
  });
});

describe("zero is the schema's rule, not the parser's", () => {
  it("keeps parseMoneyInput accepting zero, as a balance and a reconciliation need", () => {
    expect(parseMoneyInput("0", 2)).toEqual({ ok: true, minor: 0 });
    expect(parseMoneyInput("0,00", 2)).toEqual({ ok: true, minor: 0 });
    expect(parseMoneyInput("0", 0)).toEqual({ ok: true, minor: 0 });
  });
});

describe("describeMoneyInputIssue", () => {
  // A record keyed by every issue: adding a reason to `parseMoneyInput` fails the type check here
  // until its wording is added and tested.
  const expected: Record<MoneyInputIssue, string> = {
    empty: "Escribe un monto.",
    invalid: "Escribe solo números, por ejemplo 1550,50.",
    too_many_decimals: "Usa como máximo 2 decimales.",
    negative_not_allowed: "Escribe el monto sin signo.",
    too_large: "El monto es demasiado grande.",
  };

  it.each(Object.entries(expected) as [MoneyInputIssue, string][])(
    "says %s in Spanish",
    (issue, message) => {
      expect(describeMoneyInputIssue(issue, { exponent: 2 })).toBe(message);
    },
  );

  it("gives the example and the decimals of the currency", () => {
    expect(describeMoneyInputIssue("invalid", { exponent: 0 })).toBe(
      "Escribe solo números, por ejemplo 1550.",
    );
    expect(describeMoneyInputIssue("invalid", { exponent: 1 })).toBe(
      "Escribe solo números, por ejemplo 1550,5.",
    );
    expect(describeMoneyInputIssue("invalid", { exponent: 3 })).toBe(
      "Escribe solo números, por ejemplo 1550,500.",
    );
    expect(describeMoneyInputIssue("too_many_decimals", { exponent: 0 })).toBe(
      "Esta moneda no usa decimales.",
    );
    expect(describeMoneyInputIssue("too_many_decimals", { exponent: 1 })).toBe(
      "Usa como máximo 1 decimal.",
    );
  });

  it("asks for a debt without sign when the amount is a card's debt", () => {
    expect(describeMoneyInputIssue("negative_not_allowed", { exponent: 2, debt: true })).toBe(
      "Escribe la deuda en positivo, sin signo.",
    );
  });
});

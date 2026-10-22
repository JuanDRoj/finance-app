import { describe, expect, it } from "vitest";
import {
  ACCOUNT_NAME_MAX_LENGTH,
  accountEditSchema,
  accountFormSchema,
  editValuesOf,
  type AccountFormValues,
} from "./account";
import { describeMoneyInputIssue } from "./money-input";

const blank: AccountFormValues = {
  type: "bank",
  name: "Itaú",
  balance: "",
  closingDay: "",
  dueDay: "",
};

/** The body for the form's values, or the messages by field. */
function check(values: Partial<AccountFormValues>, exponent = 2) {
  const result = accountFormSchema(exponent).safeParse({ ...blank, ...values });
  if (result.success) return { body: result.data };
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) errors[String(issue.path[0])] ??= issue.message;
  return { errors };
}

describe("accountFormSchema: the body of a bank or cash account", () => {
  it("is just the type and the name when no balance is given", () => {
    expect(check({}).body).toEqual({ type: "bank", name: "Itaú" });
    expect(check({ type: "cash", name: "Billetera" }).body).toEqual({
      type: "cash",
      name: "Billetera",
    });
  });

  it("trims the name", () => {
    expect(check({ name: "  Itaú  " }).body).toMatchObject({ name: "Itaú" });
  });

  it("turns the balance into an integer of the minor unit, without floats", () => {
    expect(check({ balance: "1550,50" }).body).toMatchObject({ initial_balance_minor: 155050 });
    expect(check({ balance: "1550.5" }).body).toMatchObject({ initial_balance_minor: 155050 });
    expect(check({ balance: "0,29" }).body).toMatchObject({ initial_balance_minor: 29 });
    expect(check({ balance: "15" }, 0).body).toMatchObject({ initial_balance_minor: 15 });
    expect(check({ balance: "1,234" }, 3).body).toMatchObject({ initial_balance_minor: 1234 });
  });

  it("leaves the balance out when it is empty or zero: no adjustment to register", () => {
    expect(check({ balance: "" }).body).not.toHaveProperty("initial_balance_minor");
    expect(check({ balance: "   " }).body).not.toHaveProperty("initial_balance_minor");
    expect(check({ balance: "0" }).body).not.toHaveProperty("initial_balance_minor");
    expect(check({ balance: "0,00" }).body).not.toHaveProperty("initial_balance_minor");
    expect(check({ balance: "-0" }).body).not.toHaveProperty("initial_balance_minor");
  });

  it("accepts an overdraft with a leading minus", () => {
    expect(check({ balance: "-250,75" }).body).toMatchObject({ initial_balance_minor: -25075 });
    expect(check({ type: "cash", balance: "-10" }).body).toMatchObject({
      initial_balance_minor: -1000,
    });
  });

  it("drops the days, even if the form still holds them from the card tab", () => {
    const body = check({ type: "bank", closingDay: "5", dueDay: "12" }).body;
    expect(body).not.toHaveProperty("closing_day");
    expect(body).not.toHaveProperty("due_day");
    expect(check({ type: "cash", closingDay: "5", dueDay: "12" }).body).toEqual({
      type: "cash",
      name: "Itaú",
    });
  });
});

describe("accountFormSchema: the body of a credit card", () => {
  const card = { type: "credit_card", name: "Visa Itaú", closingDay: "5", dueDay: "12" } as const;

  it("carries the days as numbers", () => {
    expect(check(card).body).toEqual({
      type: "credit_card",
      name: "Visa Itaú",
      closing_day: 5,
      due_day: 12,
    });
  });

  it("writes the debt positive in the form and sends it negative", () => {
    expect(check({ ...card, balance: "24120" }).body).toMatchObject({
      initial_balance_minor: -2412000,
    });
    expect(check({ ...card, balance: "0,01" }).body).toMatchObject({ initial_balance_minor: -1 });
  });

  it("leaves a zero or empty debt out, and never sends negative zero", () => {
    expect(check({ ...card, balance: "" }).body).not.toHaveProperty("initial_balance_minor");
    const zero = check({ ...card, balance: "0" }).body;
    expect(zero).not.toHaveProperty("initial_balance_minor");
  });

  it("refuses a minus on the debt: it is written positive", () => {
    expect(check({ ...card, balance: "-100" }).errors).toEqual({
      balance: "Escribe la deuda en positivo, sin signo.",
    });
  });

  it("requires both days, with no default, and says which one is missing", () => {
    expect(check({ ...card, closingDay: "", dueDay: "" }).errors).toEqual({
      closingDay: "Elige un día del 1 al 31.",
      dueDay: "Elige un día del 1 al 31.",
    });
    expect(check({ ...card, dueDay: "" }).errors).toEqual({
      dueDay: "Elige un día del 1 al 31.",
    });
  });

  it.each(["0", "32", "5.5", "-3", "abc", "05", "1e1", " 5"])("refuses %s as a day", (day) => {
    expect(check({ ...card, closingDay: day }).errors).toEqual({
      closingDay: "Elige un día del 1 al 31.",
    });
  });

  it.each(["1", "9", "10", "29", "30", "31"])("accepts day %s", (day) => {
    expect(check({ ...card, closingDay: day, dueDay: day }).body).toMatchObject({
      closing_day: Number(day),
      due_day: Number(day),
    });
  });
});

describe("accountFormSchema: what it refuses, in Spanish", () => {
  it("asks for a name", () => {
    expect(check({ name: "" }).errors).toEqual({ name: "Escribe un nombre." });
    expect(check({ name: "    " }).errors).toEqual({ name: "Escribe un nombre." });
  });

  it("caps the name at 80 characters, after trimming", () => {
    expect(check({ name: "a".repeat(ACCOUNT_NAME_MAX_LENGTH) }).body).toBeDefined();
    expect(check({ name: ` ${"a".repeat(ACCOUNT_NAME_MAX_LENGTH)} ` }).body).toBeDefined();
    expect(check({ name: "a".repeat(ACCOUNT_NAME_MAX_LENGTH + 1) }).errors).toEqual({
      name: "Usa como máximo 80 caracteres.",
    });
  });

  it("counts the 80 characters of the name as the backend does: by code point, not by UTF-16 unit", () => {
    // Pydantic `max_length` (len(str)) and PostgreSQL `char_length` count code points: an emoji is
    // one character for them, but 2 in JavaScript's `.length`.
    const emojis = (count: number) => "😀".repeat(count);
    expect(emojis(80).length).toBe(160); // what zod's `.max(80)` would have refused
    expect(check({ name: emojis(80) }).body).toMatchObject({ name: emojis(80) });
    expect(check({ name: emojis(81) }).errors).toEqual({
      name: "Usa como máximo 80 caracteres.",
    });
    // A decomposed accent is two code points for the backend too ("e" + U+0301).
    expect(check({ name: "e\u0301".repeat(40) }).body).toBeDefined();
    expect(check({ name: "e\u0301".repeat(41) }).errors).toEqual({
      name: "Usa como máximo 80 caracteres.",
    });
    // Letters outside the BMP and plain ones add up in the same count.
    expect(check({ name: `${"a".repeat(40)}${emojis(40)}` }).body).toBeDefined();
    expect(check({ name: `${"a".repeat(41)}${emojis(40)}` }).errors).toEqual({
      name: "Usa como máximo 80 caracteres.",
    });
  });

  it("trims before counting, and still counts plain text as before", () => {
    expect(check({ name: ` ${"😀".repeat(80)} ` }).body).toMatchObject({ name: "😀".repeat(80) });
    expect(check({ name: "ñ".repeat(80) }).body).toBeDefined();
    expect(check({ name: "ñ".repeat(81) }).errors).toEqual({
      name: "Usa como máximo 80 caracteres.",
    });
  });

  it("reports a name that is too long together with the other problems", () => {
    const { errors } = check({ name: "😀".repeat(81), balance: "1,505" });
    expect(Object.keys(errors ?? {}).sort()).toEqual(["balance", "name"]);
    expect(errors?.name).toBe("Usa como máximo 80 caracteres.");
  });

  it("asks for a type", () => {
    const result = accountFormSchema(2).safeParse({ ...blank, type: "" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Elige un tipo de cuenta.");
    expect(accountFormSchema(2).safeParse({ ...blank, type: "savings" }).success).toBe(false);
  });

  it("explains a balance it cannot read", () => {
    expect(check({ balance: "abc" }).errors).toEqual({
      balance: "Escribe solo números, por ejemplo 1550,50.",
    });
    expect(check({ balance: "1.550,50" }).errors).toEqual({
      balance: "Escribe solo números, por ejemplo 1550,50.",
    });
    expect(check({ balance: "abc" }, 0).errors).toEqual({
      balance: "Escribe solo números, por ejemplo 1550.",
    });
  });

  it("says how many decimals the currency takes", () => {
    expect(check({ balance: "1,505" }).errors).toEqual({ balance: "Usa como máximo 2 decimales." });
    expect(check({ balance: "1,5" }, 0).errors).toEqual({
      balance: "Esta moneda no usa decimales.",
    });
    expect(check({ balance: "1,2345" }, 3).errors).toEqual({
      balance: "Usa como máximo 3 decimales.",
    });
    expect(check({ balance: "1,25" }, 1).errors).toEqual({ balance: "Usa como máximo 1 decimal." });
  });

  it("refuses an amount over the largest safe integer, like the backend", () => {
    expect(check({ balance: "90071992547409,91" }).body).toMatchObject({
      initial_balance_minor: Number.MAX_SAFE_INTEGER,
    });
    expect(check({ balance: "90071992547409,92" }).errors).toEqual({
      balance: "El monto es demasiado grande.",
    });
    expect(check({ balance: "-90071992547409,92" }).errors).toEqual({
      balance: "El monto es demasiado grande.",
    });
  });

  it("reports the problems of several fields at once", () => {
    const { errors } = check({
      type: "credit_card",
      name: "",
      balance: "x",
      closingDay: "",
      dueDay: "40",
    });
    expect(Object.keys(errors ?? {}).sort()).toEqual(["balance", "closingDay", "dueDay", "name"]);
  });
});

describe("describeMoneyInputIssue", () => {
  it("has a text for every reason, none of them a raw code", () => {
    for (const issue of [
      "empty",
      "invalid",
      "too_many_decimals",
      "negative_not_allowed",
      "too_large",
    ] as const) {
      const text = describeMoneyInputIssue(issue, { exponent: 2 });
      expect(text).not.toBe("");
      expect(text).not.toContain("_");
    }
  });

  it("shows the example with the decimals of the currency", () => {
    expect(describeMoneyInputIssue("invalid", { exponent: 3 })).toBe(
      "Escribe solo números, por ejemplo 1550,500.",
    );
  });
});

describe("accountEditSchema", () => {
  const bank = { type: "bank", name: "Itaú", closing_day: null, due_day: null } as const;
  const card = { type: "credit_card", name: "Visa", closing_day: 5, due_day: 12 } as const;
  const run = (
    account: typeof bank | typeof card,
    values: Partial<ReturnType<typeof editValuesOf>>,
  ) => accountEditSchema(account).safeParse({ ...editValuesOf(account), ...values });

  it("starts from the account's own values, the card's days included", () => {
    expect(editValuesOf(card)).toEqual({ name: "Visa", closingDay: "5", dueDay: "12" });
    expect(editValuesOf(bank)).toEqual({ name: "Itaú", closingDay: "", dueDay: "" });
  });

  it("is an empty body when nothing changed", () => {
    expect(run(bank, {}).data).toEqual({});
    expect(run(card, {}).data).toEqual({});
  });

  it("sends only what changed", () => {
    expect(run(bank, { name: "  Santander " }).data).toEqual({ name: "Santander" });
    expect(run(card, { dueDay: "20" }).data).toEqual({ due_day: 20 });
    expect(run(card, { name: "Visa Oro", closingDay: "6" }).data).toEqual({
      name: "Visa Oro",
      closing_day: 6,
    });
  });

  it("never sends days for bank or cash, even if the form holds some", () => {
    expect(run(bank, { name: "X", closingDay: "5", dueDay: "6" }).data).toEqual({ name: "X" });
  });

  it("refuses an empty name and one past 80 characters (by code point)", () => {
    expect(run(bank, { name: "  " }).error?.issues[0]?.message).toBe("Escribe un nombre.");
    expect(run(bank, { name: "a".repeat(81) }).success).toBe(false);
    expect(run(bank, { name: "😀".repeat(80) }).success).toBe(true);
  });

  it("requires a card's two days", () => {
    const result = run(card, { closingDay: "", dueDay: "32" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual(["closingDay", "dueDay"]);
  });
});

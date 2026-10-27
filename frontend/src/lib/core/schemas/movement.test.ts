import { describe, expect, it } from "vitest";
import {
  MOVEMENT_DESCRIPTION_MAX_LENGTH,
  MOVEMENT_TYPES,
  movementFormFieldOf,
  movementFormSchema,
  type MovementFormValues,
} from "./movement";

const ACCOUNT = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0002";
const OTHER_ACCOUNT = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0003";
const CATEGORY = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0010";

/** A form as it is when it is ready to send: an expense with everything filled in. */
function values(overrides: Partial<MovementFormValues> = {}): MovementFormValues {
  return {
    type: "expense",
    amount: "2340,50",
    accountId: ACCOUNT,
    toAccountId: "",
    categoryId: CATEGORY,
    date: "2026-10-26",
    description: "",
    ...overrides,
  };
}

/** The messages of a failed parse by field, or `null` if it passed. */
function errorsOf(input: unknown, exponent = 2): Record<string, string> | null {
  const result = movementFormSchema(exponent).safeParse(input);
  if (result.success) return null;
  const byField: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? "");
    byField[field] ??= issue.message;
  }
  return byField;
}

function bodyOf(input: unknown, exponent = 2) {
  const result = movementFormSchema(exponent).safeParse(input);
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
  return result.data;
}

describe("movementFormSchema: the body of each type", () => {
  it("turns an expense into the body of the backend, the amount in the minor unit", () => {
    expect(bodyOf(values())).toEqual({
      type: "expense",
      account_id: ACCOUNT,
      category_id: CATEGORY,
      amount_minor: 234050,
      date: "2026-10-26",
    });
  });

  it("turns an income into its body", () => {
    expect(bodyOf(values({ type: "income", amount: "50000" }))).toEqual({
      type: "income",
      account_id: ACCOUNT,
      category_id: CATEGORY,
      amount_minor: 5000000,
      date: "2026-10-26",
    });
  });

  it("turns a transfer into from/to accounts with no category", () => {
    const body = bodyOf(
      values({
        type: "transfer",
        amount: "12000",
        toAccountId: OTHER_ACCOUNT,
        categoryId: CATEGORY,
      }),
    );
    expect(body).toEqual({
      type: "transfer",
      from_account_id: ACCOUNT,
      to_account_id: OTHER_ACCOUNT,
      amount_minor: 1200000,
      date: "2026-10-26",
    });
    expect(body).not.toHaveProperty("category_id");
    expect(body).not.toHaveProperty("account_id");
  });

  it("ignores what belongs to another type: a transfer's 'Hacia' on an expense", () => {
    const body = bodyOf(values({ toAccountId: OTHER_ACCOUNT }));
    expect(body).not.toHaveProperty("to_account_id");
    expect(body).not.toHaveProperty("from_account_id");
  });

  it("offers the three types a person registers and no adjustment", () => {
    expect([...MOVEMENT_TYPES]).toEqual(["expense", "income", "transfer"]);
    expect(errorsOf(values({ type: "adjustment" as never }))).toHaveProperty("type");
  });
});

describe("movementFormSchema: the amount", () => {
  it.each([
    ["1550,50", 2, 155050],
    ["1550.5", 2, 155050],
    ["0,01", 2, 1],
    ["15", 2, 1500],
    ["1500", 0, 1500],
    ["1,234", 3, 1234],
  ])("reads %s with exponent %i as %i", (amount, exponent, minor) => {
    expect(bodyOf(values({ amount }), exponent)).toMatchObject({ amount_minor: minor });
  });

  it("refuses zero, with the text of KAN-75", () => {
    expect(errorsOf(values({ amount: "0" }))).toEqual({ amount: "El monto debe ser mayor que 0." });
    expect(errorsOf(values({ amount: "0,00" }))).toEqual({
      amount: "El monto debe ser mayor que 0.",
    });
  });

  it("refuses a negative amount: the backend applies the sign", () => {
    expect(errorsOf(values({ amount: "-100" }))).toEqual({ amount: "Escribe el monto sin signo." });
  });

  it("refuses more decimals than the currency has, never rounding", () => {
    expect(errorsOf(values({ amount: "1,999" }))).toEqual({
      amount: "Usa como máximo 2 decimales.",
    });
    expect(errorsOf(values({ amount: "1.234" }))).toEqual({
      amount: "Usa como máximo 2 decimales.",
    });
    expect(errorsOf(values({ amount: "1,5" }), 0)).toEqual({
      amount: "Esta moneda no usa decimales.",
    });
  });

  it("refuses an empty amount, text that is not a number and one beyond the safe integer", () => {
    expect(errorsOf(values({ amount: "" }))).toEqual({ amount: "Escribe un monto." });
    expect(errorsOf(values({ amount: "  " }))).toEqual({ amount: "Escribe un monto." });
    expect(errorsOf(values({ amount: "mil" }))?.amount).toContain("Escribe solo números");
    expect(errorsOf(values({ amount: "99999999999999999" }))).toEqual({
      amount: "El monto es demasiado grande.",
    });
  });

  it("accepts the largest amount the backend accepts, as an exact integer", () => {
    expect(bodyOf(values({ amount: "90071992547409,91" }))).toMatchObject({
      amount_minor: Number.MAX_SAFE_INTEGER,
    });
  });

  it("builds the schema only for a valid exponent", () => {
    expect(() => movementFormSchema(-1)).toThrow(RangeError);
    expect(() => movementFormSchema(2.5)).toThrow(RangeError);
  });
});

describe("movementFormSchema: accounts and category", () => {
  it("asks for a category on an expense and on an income", () => {
    expect(errorsOf(values({ categoryId: "" }))).toEqual({ categoryId: "Elige una categoría." });
    expect(errorsOf(values({ type: "income", categoryId: "" }))).toEqual({
      categoryId: "Elige una categoría.",
    });
  });

  it("asks for an account on an expense and an income", () => {
    expect(errorsOf(values({ accountId: "" }))).toEqual({ accountId: "Elige una cuenta." });
  });

  it("does not ask for a category on a transfer", () => {
    expect(
      errorsOf(values({ type: "transfer", toAccountId: OTHER_ACCOUNT, categoryId: "" })),
    ).toBeNull();
  });

  it("asks for both accounts on a transfer, with their own texts", () => {
    expect(errorsOf(values({ type: "transfer", accountId: "", toAccountId: "" }))).toEqual({
      accountId: "Elige la cuenta de origen.",
      toAccountId: "Elige la cuenta de destino.",
    });
  });

  it("refuses a transfer to the same account, as the backend does (transfer_same_account)", () => {
    expect(errorsOf(values({ type: "transfer", toAccountId: ACCOUNT }))).toEqual({
      toAccountId: "Elige dos cuentas distintas.",
    });
  });
});

describe("movementFormSchema: the date", () => {
  it("accepts a real day", () => {
    expect(bodyOf(values({ date: "2028-02-29" }))).toMatchObject({ date: "2028-02-29" });
  });

  it.each(["", "2026-10", "26/10/2026", "2026-02-30", "2027-02-29", "2026-10-26T00:00:00"])(
    "refuses %j",
    (date) => {
      expect(errorsOf(values({ date }))).toEqual({ date: "Elige una fecha." });
    },
  );
});

describe("movementFormSchema: the description", () => {
  it("leaves it out when it is empty or only spaces: the backend refuses an empty one", () => {
    expect(bodyOf(values({ description: "" }))).not.toHaveProperty("description");
    expect(bodyOf(values({ description: "   \n " }))).not.toHaveProperty("description");
  });

  it("trims it and sends it", () => {
    expect(bodyOf(values({ description: "  Tienda Inglesa  " }))).toMatchObject({
      description: "Tienda Inglesa",
    });
  });

  it("accepts exactly the maximum and refuses one more", () => {
    const max = "a".repeat(MOVEMENT_DESCRIPTION_MAX_LENGTH);
    expect(MOVEMENT_DESCRIPTION_MAX_LENGTH).toBe(200);
    expect(bodyOf(values({ description: max }))).toMatchObject({ description: max });
    expect(errorsOf(values({ description: `${max}a` }))).toEqual({
      description: "Usa como máximo 200 caracteres.",
    });
  });

  it("counts code points, not UTF-16 units: 200 emojis fit", () => {
    const emojis = "😀".repeat(MOVEMENT_DESCRIPTION_MAX_LENGTH);
    expect(emojis.length).toBe(400);
    expect(bodyOf(values({ description: emojis }))).toMatchObject({ description: emojis });
    expect(errorsOf(values({ description: `${emojis}😀` }))).toHaveProperty("description");
  });

  it("does not count the spaces the trim takes away", () => {
    const max = "a".repeat(MOVEMENT_DESCRIPTION_MAX_LENGTH);
    expect(bodyOf(values({ description: `   ${max}   ` }))).toMatchObject({ description: max });
  });
});

describe("movementFormSchema: every problem at once", () => {
  it("reports an empty expense by field, together", () => {
    expect(
      errorsOf({
        type: "expense",
        amount: "",
        accountId: "",
        toAccountId: "",
        categoryId: "",
        date: "",
        description: "",
      }),
    ).toEqual({
      amount: "Escribe un monto.",
      date: "Elige una fecha.",
      accountId: "Elige una cuenta.",
      categoryId: "Elige una categoría.",
    });
  });

  it("reports a bad amount together with a missing category and a long description", () => {
    const errors = errorsOf(values({ amount: "0", categoryId: "", description: "x".repeat(201) }));
    expect(Object.keys(errors ?? {}).sort()).toEqual(["amount", "categoryId", "description"]);
  });

  it("reports the problems of a transfer together", () => {
    expect(
      errorsOf(values({ type: "transfer", amount: "-5", toAccountId: ACCOUNT, date: "" })),
    ).toEqual({
      amount: "Escribe el monto sin signo.",
      date: "Elige una fecha.",
      toAccountId: "Elige dos cuentas distintas.",
    });
  });

  it("does not run a failed parse into a body", () => {
    const result = movementFormSchema(2).safeParse(values({ amount: "" }));
    expect(result.success).toBe(false);
  });
});

describe("movementFormFieldOf", () => {
  it.each([
    ["expense.account_id", "accountId"],
    ["income.account_id", "accountId"],
    ["transfer.from_account_id", "accountId"],
    ["transfer.to_account_id", "toAccountId"],
    ["expense.category_id", "categoryId"],
    ["income.category_id", "categoryId"],
    ["expense.amount_minor", "amount"],
    ["income.amount_minor", "amount"],
    ["transfer.amount_minor", "amount"],
    ["expense.date", "date"],
    ["transfer.description", "description"],
    ["expense.type", "type"],
  ] as const)("maps the location %s to the field %s", (path, field) => {
    expect(movementFormFieldOf(path)).toBe(field);
  });

  it("also maps a path that already lost the type", () => {
    expect(movementFormFieldOf("amount_minor")).toBe("amount");
    expect(movementFormFieldOf("from_account_id")).toBe("accountId");
    expect(movementFormFieldOf("type")).toBe("type");
  });

  it("gives undefined for what the person cannot fix in a field", () => {
    expect(movementFormFieldOf("")).toBeUndefined();
    expect(movementFormFieldOf("expense")).toBeUndefined();
    expect(movementFormFieldOf("expense.extra")).toBeUndefined();
    expect(movementFormFieldOf("expense.account_id.x")).toBeUndefined();
    expect(movementFormFieldOf("adjustment.account_id")).toBeUndefined();
    expect(movementFormFieldOf("path.space_id")).toBeUndefined();
  });

  it("never reads inherited keys", () => {
    for (const path of ["constructor", "expense.toString", "__proto__", "transfer.__proto__"]) {
      expect(movementFormFieldOf(path)).toBeUndefined();
    }
  });
});

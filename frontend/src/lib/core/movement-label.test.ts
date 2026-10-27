import { describe, expect, it } from "vitest";
import type { MovementCreate } from "./data/transactions";
import {
  TOAST_LABEL_MAX_LENGTH,
  describeRegisteredMovement,
  truncateLabel,
} from "./movement-label";

const ACCOUNTS = new Map([
  ["a1", "Itaú"],
  ["a2", "Visa Itaú"],
]);

const EXPENSE: MovementCreate = {
  type: "expense",
  account_id: "a1",
  category_id: "c1",
  amount_minor: 234050,
  date: "2026-10-26",
};
const TRANSFER: MovementCreate = {
  type: "transfer",
  from_account_id: "a1",
  to_account_id: "a2",
  amount_minor: 1200000,
  date: "2026-10-26",
};

describe("truncateLabel", () => {
  it("leaves a short text as it is", () => {
    expect(truncateLabel("Comida")).toBe("Comida");
    expect(truncateLabel("a".repeat(TOAST_LABEL_MAX_LENGTH))).toBe("a".repeat(40));
  });

  it("cuts a long text to 40 code points, the ellipsis included", () => {
    const cut = truncateLabel("a".repeat(100));
    expect(cut).toBe(`${"a".repeat(39)}…`);
    expect([...cut]).toHaveLength(TOAST_LABEL_MAX_LENGTH);
  });

  it("counts an emoji as one and never splits it", () => {
    const cut = truncateLabel("😀".repeat(60));
    expect(cut).toBe(`${"😀".repeat(39)}…`);
    expect([...cut]).toHaveLength(40);
  });

  it("does not leave a space before the ellipsis", () => {
    const text = `${"a".repeat(38)} ${"b".repeat(20)}`;
    expect(truncateLabel(text)).toBe(`${"a".repeat(38)}…`);
  });

  it("takes another maximum", () => {
    expect(truncateLabel("abcdefghij", 5)).toBe("abcd…");
  });
});

describe("describeRegisteredMovement", () => {
  it("uses the description when there is one", () => {
    expect(
      describeRegisteredMovement(
        { ...EXPENSE, description: "Tienda Inglesa" },
        { category: "Supermercado", accountNames: ACCOUNTS },
      ),
    ).toBe("Tienda Inglesa");
  });

  it("uses the name of the category of an expense or an income when there is no description", () => {
    expect(
      describeRegisteredMovement(EXPENSE, { category: "Taxi y apps", accountNames: ACCOUNTS }),
    ).toBe("Taxi y apps");
    expect(
      describeRegisteredMovement(
        { ...EXPENSE, type: "income" },
        { category: "Sueldo", accountNames: ACCOUNTS },
      ),
    ).toBe("Sueldo");
  });

  it("names the accounts of a transfer without a description", () => {
    expect(describeRegisteredMovement(TRANSFER, { accountNames: ACCOUNTS })).toBe(
      "Itaú → Visa Itaú",
    );
  });

  it("prefers the description of a transfer to its accounts", () => {
    expect(
      describeRegisteredMovement(
        { ...TRANSFER, description: "Pago de la tarjeta" },
        { accountNames: ACCOUNTS },
      ),
    ).toBe("Pago de la tarjeta");
  });

  it("falls back to the type of movement when a name is missing, never an id or 'undefined'", () => {
    expect(describeRegisteredMovement(EXPENSE, { accountNames: ACCOUNTS })).toBe("Gasto");
    expect(describeRegisteredMovement(EXPENSE, { category: null, accountNames: ACCOUNTS })).toBe(
      "Gasto",
    );
    expect(describeRegisteredMovement(EXPENSE, { category: "  ", accountNames: ACCOUNTS })).toBe(
      "Gasto",
    );
    expect(describeRegisteredMovement(TRANSFER, { accountNames: new Map() })).toBe("Transferencia");
    expect(describeRegisteredMovement(TRANSFER, { accountNames: new Map([["a1", "Itaú"]]) })).toBe(
      "Transferencia",
    );
  });

  it("cuts a 200-character description, and long names", () => {
    const long = "x".repeat(200);
    const label = describeRegisteredMovement(
      { ...EXPENSE, description: long },
      { accountNames: ACCOUNTS },
    );
    expect([...label]).toHaveLength(40);
    expect(label.endsWith("…")).toBe(true);
    const transfer = describeRegisteredMovement(TRANSFER, {
      accountNames: new Map([
        ["a1", "Cuenta de ahorro en pesos de la caja de ahorro"],
        ["a2", "Tarjeta de crédito"],
      ]),
    });
    expect([...transfer].length).toBeLessThanOrEqual(40);
  });
});

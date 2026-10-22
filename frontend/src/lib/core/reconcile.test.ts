import { describe, expect, it } from "vitest";
import { RECONCILE_LABEL, describeReconcilePreview, previewReconcile } from "./reconcile";

const UYU = { code: "UYU", exponent: 2 };
const bank = { type: "bank", balance_minor: 8425000 } as const;
const card = { type: "credit_card", balance_minor: -2412000 } as const;

describe("previewReconcile", () => {
  it("is empty for no text", () => {
    expect(previewReconcile("", bank, UYU)).toEqual({ kind: "empty" });
    expect(previewReconcile("   ", bank, UYU)).toEqual({ kind: "empty" });
  });

  it("reports why an amount is not valid, in Spanish", () => {
    expect(previewReconcile("abc", bank, UYU)).toMatchObject({ kind: "invalid" });
    expect(previewReconcile("1,234", bank, UYU)).toMatchObject({
      kind: "invalid",
      message: "Usa como máximo 2 decimales.",
    });
    expect(previewReconcile("-5", card, UYU)).toMatchObject({
      kind: "invalid",
      message: "Escribe la deuda en positivo, sin signo.",
    });
  });

  it("is 'same' when the real balance is the one in Kanza", () => {
    expect(previewReconcile("84250", bank, UYU)).toEqual({ kind: "same" });
    expect(previewReconcile("84.250,00", bank, UYU)).toMatchObject({ kind: "invalid" }); // no thousands separator
    expect(previewReconcile("24120,00", card, UYU)).toEqual({ kind: "same" });
  });

  it("computes the adjustment of a bank or cash account with the balance's sign", () => {
    expect(previewReconcile("85000,50", bank, UYU)).toEqual({
      kind: "change",
      delta: BigInt(75050),
      body: { balance_minor: 8500050 },
    });
    expect(previewReconcile("84000", bank, UYU)).toMatchObject({ delta: BigInt(-25000) });
  });

  it("accepts a minus on a bank account (an overdraft) and zero as a valid balance", () => {
    expect(previewReconcile("-100", bank, UYU)).toMatchObject({
      body: { balance_minor: -10000 },
    });
    expect(previewReconcile("0", bank, UYU)).toMatchObject({
      delta: BigInt(-8425000),
      body: { balance_minor: 0 },
    });
  });

  it("sends a card's real debt, written positive, as a negative balance; zero debt is 0", () => {
    expect(previewReconcile("25000", card, UYU)).toEqual({
      kind: "change",
      delta: BigInt(-88000),
      body: { balance_minor: -2500000 },
    });
    const zero = previewReconcile("0", card, UYU);
    expect(zero).toMatchObject({ kind: "change", body: { balance_minor: 0 } });
    expect(Object.is((zero as { body: { balance_minor: number } }).body.balance_minor, -0)).toBe(
      false,
    );
  });

  it("is exact at the backend's cap", () => {
    const max = { type: "bank", balance_minor: 9007199254740991 } as const;
    expect(previewReconcile("-90071992547409,91", max, UYU)).toMatchObject({
      delta: BigInt(-9007199254740991) * BigInt(2),
    });
  });

  it("works with currencies of 0 and 3 decimals", () => {
    expect(
      previewReconcile("1500", { type: "bank", balance_minor: 1000 }, { code: "COP", exponent: 0 }),
    ).toMatchObject({ delta: BigInt(500) });
    expect(
      previewReconcile("1,5", { type: "bank", balance_minor: 1000 }, { code: "KWD", exponent: 3 }),
    ).toMatchObject({ delta: BigInt(500) });
  });
});

describe("describeReconcilePreview", () => {
  const text = (value: string, account: typeof bank | typeof card = bank) =>
    describeReconcilePreview(previewReconcile(value, account, UYU), account, UYU);

  it("says what to write per type while the field is empty", () => {
    expect(text("")).toBe("Escribe el saldo que ves en tu banco.");
    expect(text("", { type: "cash", balance_minor: 0 } as never)).toBe(
      "Escribe el saldo que tienes en efectivo.",
    );
    expect(text("", card)).toBe("Escribe el saldo que dice el resumen de tu tarjeta.");
  });

  it("announces an adjustment with + or − (U+2212)", () => {
    expect(text("85000")).toBe(
      "Se registrará un ajuste de +$\u00A0750,00. No cuenta como ingreso ni gasto.",
    );
    expect(text("84000")).toBe(
      "Se registrará un ajuste de −$\u00A0250,00. No cuenta como ingreso ni gasto.",
    );
  });

  it("tells a card's change in words, without a sign", () => {
    expect(text("25000", card)).toBe(
      "Tu deuda sube $\u00A0880,00. No cuenta como ingreso ni gasto.",
    );
    expect(text("20000", card)).toBe(
      "Tu deuda baja $\u00A04.120,00. No cuenta como ingreso ni gasto.",
    );
  });

  it("says nothing is registered when it already matches", () => {
    expect(text("84250")).toBe("El saldo ya coincide: no se registra ningún ajuste.");
  });
});

describe("RECONCILE_LABEL", () => {
  it("names the field by type", () => {
    expect(RECONCILE_LABEL).toEqual({
      bank: "Saldo real en tu banco",
      cash: "Efectivo que tienes",
      credit_card: "Deuda real de la tarjeta",
    });
  });
});

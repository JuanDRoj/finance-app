import { describe, expect, it } from "vitest";
import {
  accountAmountView,
  balanceAfterText,
  balanceColumnLabel,
  balanceDelta,
  describeAccountEmpty,
  describeAccountTableCaption,
  describeMonthFigure,
  monthFigureLabel,
  monthFigureText,
  monthNameFor,
} from "./account-movements";
import type { MovementListItem } from "./data/transactions";

const UYU = { code: "UYU", exponent: 2 };
const CLP = { code: "CLP", exponent: 0 };
const KWD = { code: "KWD", exponent: 3 };

const ITAU = { id: "a1", name: "Itaú", type: "bank" } as const;
const VISA = { id: "a2", name: "Visa Itaú", type: "credit_card" } as const;
const BANK = { id: "a1", type: "bank" } as const;
const CASH = { id: "a3", type: "cash" } as const;
const CARD = { id: "a2", type: "credit_card" } as const;

type Item = Pick<
  MovementListItem,
  "type" | "amount_minor" | "account" | "from_account" | "to_account"
>;

function expense(amount: number): Item {
  return {
    type: "expense",
    amount_minor: amount,
    account: null,
    from_account: null,
    to_account: null,
  };
}
function income(amount: number): Item {
  return {
    type: "income",
    amount_minor: amount,
    account: null,
    from_account: null,
    to_account: null,
  };
}
function adjustment(amount: number): Item {
  return {
    type: "adjustment",
    amount_minor: amount,
    account: null,
    from_account: null,
    to_account: null,
  };
}
// A transfer arrives unsigned: the account decides whether it came in or went out.
type Ref = { id: string; name: string; type: "bank" | "cash" | "credit_card" };
function transfer(amount: number, from: Ref = ITAU, to: Ref = VISA): Item {
  return {
    type: "transfer",
    amount_minor: amount,
    account: null,
    from_account: from,
    to_account: to,
  };
}

describe("balanceDelta", () => {
  it("lowers the balance with an expense and raises it with an income, whatever the sign it came with", () => {
    expect(balanceDelta(expense(-38000), "a1")).toBe(BigInt(-38000));
    expect(balanceDelta(expense(38000), "a1")).toBe(BigInt(-38000));
    expect(balanceDelta(income(6800000), "a1")).toBe(BigInt(6800000));
    expect(balanceDelta(income(-6800000), "a1")).toBe(BigInt(6800000));
  });

  it("keeps the sign an adjustment carries", () => {
    expect(balanceDelta(adjustment(-30000), "a1")).toBe(BigInt(-30000));
    expect(balanceDelta(adjustment(30000), "a1")).toBe(BigInt(30000));
  });

  it("lowers the account a transfer comes from and raises the one it goes to", () => {
    expect(balanceDelta(transfer(1850000), "a1")).toBe(BigInt(-1850000));
    expect(balanceDelta(transfer(1850000), "a2")).toBe(BigInt(1850000));
  });

  it("moves nothing for a transfer that does not touch the account", () => {
    expect(balanceDelta(transfer(1850000), "other")).toBe(BigInt(0));
  });

  it("moves nothing for a movement of another account", () => {
    const ofItau = { ...expense(-38000), account: ITAU };
    expect(balanceDelta(ofItau, "a1")).toBe(BigInt(-38000));
    expect(balanceDelta(ofItau, "a2")).toBe(BigInt(0));
    expect(balanceDelta({ ...adjustment(5000), account: VISA }, "a1")).toBe(BigInt(0));
  });

  it("is exact at the cap of the backend", () => {
    expect(balanceDelta(expense(-Number.MAX_SAFE_INTEGER), "a1")).toBe(
      BigInt(-Number.MAX_SAFE_INTEGER),
    );
  });
});

describe("accountAmountView in a bank or cash account", () => {
  it("writes an expense with the minus in the text color", () => {
    expect(accountAmountView(expense(-38000), BANK, UYU)).toEqual({
      text: "\u2212$\u00A0380,00",
      tone: "default",
    });
  });

  it("writes an income with a plus in the income color", () => {
    expect(accountAmountView(income(6800000), BANK, UYU)).toEqual({
      text: "+$\u00A068.000,00",
      tone: "income",
    });
  });

  it("writes a transfer with the sign of its direction, quietly", () => {
    expect(accountAmountView(transfer(1850000), BANK, UYU)).toEqual({
      text: "\u2212$\u00A018.500,00",
      tone: "muted",
    });
    expect(accountAmountView(transfer(300000, ITAU, { ...ITAU, id: "a3" }), CASH, UYU)).toEqual({
      text: "+$\u00A03.000,00",
      tone: "muted",
    });
  });

  it("writes an adjustment with its own sign, quietly", () => {
    expect(accountAmountView(adjustment(8500000), BANK, UYU)).toEqual({
      text: "+$\u00A085.000,00",
      tone: "muted",
    });
    expect(accountAmountView(adjustment(-30000), BANK, UYU).text).toBe("\u2212$\u00A0300,00");
  });

  it("follows the exponent of the currency", () => {
    expect(accountAmountView(expense(-1500), BANK, CLP).text).toBe("\u2212CLP\u00A01.500");
    expect(accountAmountView(income(1500), BANK, KWD).text).toContain("1,500");
  });

  it("never loses a digit of the biggest amount", () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(accountAmountView(income(max), BANK, UYU).text).toBe("+$\u00A090.071.992.547.409,91");
  });
});

describe("accountAmountView in a card, read as debt", () => {
  it("writes a purchase without a sign: the debt grows", () => {
    expect(accountAmountView(expense(-234000), CARD, UYU)).toEqual({
      text: "$\u00A02.340,00",
      tone: "default",
    });
  });

  it("writes a payment received with a minus: the debt falls", () => {
    expect(accountAmountView(transfer(1850000), CARD, UYU)).toEqual({
      text: "\u2212$\u00A018.500,00",
      tone: "muted",
    });
  });

  it("writes a refund (an income) with a minus and the income color", () => {
    expect(accountAmountView(income(50000), CARD, UYU)).toEqual({
      text: "\u2212$\u00A0500,00",
      tone: "income",
    });
  });

  it("writes an adjustment that lowers the debt with a minus and one that raises it without sign", () => {
    expect(accountAmountView(adjustment(2500000), CARD, UYU).text).toBe("\u2212$\u00A025.000,00");
    expect(accountAmountView(adjustment(-2500000), CARD, UYU)).toEqual({
      text: "$\u00A025.000,00",
      tone: "muted",
    });
  });

  it("writes a transfer out of the card (a cash advance) without sign", () => {
    expect(accountAmountView(transfer(100000, VISA, ITAU), CARD, UYU).text).toBe("$\u00A01.000,00");
  });
});

describe("balanceColumnLabel", () => {
  it("says Saldo for a bank or cash account and Deuda for a card", () => {
    expect(balanceColumnLabel("bank")).toBe("Saldo");
    expect(balanceColumnLabel("cash")).toBe("Saldo");
    expect(balanceColumnLabel("credit_card")).toBe("Deuda");
  });
});

describe("balanceAfterText", () => {
  it("writes the balance the backend sent, never one computed here", () => {
    expect(balanceAfterText({ balance_after_minor: 8425000 }, "bank", UYU)).toBe(
      "$\u00A084.250,00",
    );
    expect(balanceAfterText({ balance_after_minor: -1200 }, "cash", UYU)).toBe(
      "\u2212$\u00A012,00",
    );
    expect(balanceAfterText({ balance_after_minor: 0 }, "bank", UYU)).toBe("$\u00A00,00");
  });

  it("writes the debt of a card as the opposite of its balance", () => {
    expect(balanceAfterText({ balance_after_minor: -2412000 }, "credit_card", UYU)).toBe(
      "$\u00A024.120,00",
    );
    expect(balanceAfterText({ balance_after_minor: 0 }, "credit_card", UYU)).toBe("$\u00A00,00");
  });

  it("writes a card paid in excess as a negative debt, as the header does", () => {
    expect(balanceAfterText({ balance_after_minor: 1000 }, "credit_card", UYU)).toBe(
      "\u2212$\u00A010,00",
    );
  });

  it("has no text for a movement that does not count for a balance", () => {
    expect(balanceAfterText({ balance_after_minor: null }, "bank", UYU)).toBeNull();
    expect(balanceAfterText({ balance_after_minor: null }, "credit_card", UYU)).toBeNull();
  });

  it("negates exactly at the cap of the backend", () => {
    expect(
      balanceAfterText({ balance_after_minor: -Number.MAX_SAFE_INTEGER }, "credit_card", UYU),
    ).toBe("$\u00A090.071.992.547.409,91");
  });
});

describe("describeMonthFigure", () => {
  const SUMMARY = { balance_change_minor: 4535000, expense_minor: 458000 };

  it("writes the net movement of a bank or cash account from the balance change, with a sign", () => {
    expect(describeMonthFigure(SUMMARY, "bank", "2026-10", "2026-10", UYU)).toEqual({
      label: "Movimiento neto de octubre",
      text: "+$\u00A045.350,00",
    });
    expect(
      describeMonthFigure(
        { ...SUMMARY, balance_change_minor: -285000 },
        "cash",
        "2026-10",
        "2026-10",
        UYU,
      ),
    ).toEqual({ label: "Movimiento neto de octubre", text: "\u2212$\u00A02.850,00" });
  });

  it("writes a net of zero without a sign", () => {
    expect(
      describeMonthFigure(
        { ...SUMMARY, balance_change_minor: 0 },
        "bank",
        "2026-10",
        "2026-10",
        UYU,
      )?.text,
    ).toBe("$\u00A00,00");
  });

  it("ignores expense_minor for a bank: the figure is the balance change, not income minus expense", () => {
    const figure = describeMonthFigure(
      { balance_change_minor: 4535000, expense_minor: 999 },
      "bank",
      "2026-10",
      "2026-10",
      UYU,
    );
    expect(figure?.text).toBe("+$\u00A045.350,00");
  });

  it("has no figure when the balance change is missing: never a zero", () => {
    expect(
      describeMonthFigure(
        { balance_change_minor: null, expense_minor: 0 },
        "bank",
        "2026-10",
        "2026-10",
        UYU,
      ),
    ).toBeNull();
    expect(describeMonthFigure({ expense_minor: 0 }, "cash", "2026-10", "2026-10", UYU)).toBeNull();
  });

  it("writes the consumos of a card from expense_minor, unsigned", () => {
    expect(describeMonthFigure(SUMMARY, "credit_card", "2026-10", "2026-10", UYU)).toEqual({
      label: "Consumos de octubre",
      text: "$\u00A04.580,00",
    });
  });

  it("does not need a balance change for a card", () => {
    expect(
      describeMonthFigure(
        { balance_change_minor: null, expense_minor: 0 },
        "credit_card",
        "2026-10",
        "2026-10",
        UYU,
      ),
    ).toEqual({ label: "Consumos de octubre", text: "$\u00A00,00" });
  });

  it("adds the year to the month of another year", () => {
    expect(describeMonthFigure(SUMMARY, "bank", "2025-10", "2026-10", UYU)?.label).toBe(
      "Movimiento neto de octubre de 2025",
    );
    expect(describeMonthFigure(SUMMARY, "credit_card", "2025-12", "2026-10", UYU)?.label).toBe(
      "Consumos de diciembre de 2025",
    );
  });

  it("keeps every digit of the biggest amounts", () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(
      describeMonthFigure(
        { balance_change_minor: -max, expense_minor: max },
        "bank",
        "2026-10",
        "2026-10",
        UYU,
      )?.text,
    ).toBe("\u2212$\u00A090.071.992.547.409,91");
    expect(
      describeMonthFigure(
        { balance_change_minor: 0, expense_minor: max },
        "credit_card",
        "2026-10",
        "2026-10",
        UYU,
      )?.text,
    ).toBe("$\u00A090.071.992.547.409,91");
  });
});

describe("monthFigureLabel and monthFigureText", () => {
  it("name the figure without needing the data", () => {
    expect(monthFigureLabel("bank", "2026-10", "2026-10")).toBe("Movimiento neto de octubre");
    expect(monthFigureLabel("cash", "2026-10", "2026-10")).toBe("Movimiento neto de octubre");
    expect(monthFigureLabel("credit_card", "2026-10", "2026-10")).toBe("Consumos de octubre");
  });

  it("write the amount of a card from expense_minor and of the rest from balance_change_minor", () => {
    const summary = { balance_change_minor: -285000, expense_minor: 12345 };
    expect(monthFigureText(summary, "credit_card", UYU)).toBe("$\u00A0123,45");
    expect(monthFigureText(summary, "bank", UYU)).toBe("\u2212$\u00A02.850,00");
    expect(monthFigureText(summary, "cash", UYU)).toBe("\u2212$\u00A02.850,00");
  });

  it("have no amount for a bank whose balance change is missing", () => {
    expect(monthFigureText({ expense_minor: 1 }, "bank", UYU)).toBeNull();
    expect(
      monthFigureText({ balance_change_minor: null, expense_minor: 1 }, "cash", UYU),
    ).toBeNull();
  });
});

describe("monthNameFor", () => {
  it("leaves the year out for a month of the current year", () => {
    expect(monthNameFor("2026-01", "2026-10")).toBe("enero");
    expect(monthNameFor("2026-12", "2026-10")).toBe("diciembre");
  });

  it("writes the year for any other year, also across the new year", () => {
    expect(monthNameFor("2025-12", "2026-01")).toBe("diciembre de 2025");
    expect(monthNameFor("2027-01", "2026-12")).toBe("enero de 2027");
  });
});

describe("describeAccountEmpty", () => {
  it("says this month for the current one", () => {
    expect(describeAccountEmpty("2026-10", "2026-10", false)).toBe(
      "Esta cuenta no tiene movimientos este mes",
    );
  });

  it("names any other month, with the year when it is not this year's", () => {
    expect(describeAccountEmpty("2026-09", "2026-10", false)).toBe(
      "Esta cuenta no tiene movimientos en setiembre",
    );
    expect(describeAccountEmpty("2025-09", "2026-10", false)).toBe(
      "Esta cuenta no tiene movimientos en setiembre de 2025",
    );
    // A month ahead of the current one is named too, not "este mes".
    expect(describeAccountEmpty("2026-11", "2026-10", false)).toBe(
      "Esta cuenta no tiene movimientos en noviembre",
    );
  });

  it("talks about the type, not the month, when a type is chosen", () => {
    expect(describeAccountEmpty("2026-10", "2026-10", true)).toBe(
      "No hay movimientos de este tipo",
    );
    expect(describeAccountEmpty("2026-09", "2026-10", true)).toBe(
      "No hay movimientos de este tipo",
    );
  });
});

describe("describeAccountTableCaption", () => {
  it("names the account and the period", () => {
    expect(describeAccountTableCaption("Itaú", "Octubre 2026")).toBe(
      "Movimientos de Itaú en Octubre 2026",
    );
  });
});

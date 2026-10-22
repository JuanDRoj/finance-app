import { describe, expect, it } from "vitest";
import {
  groupAccounts,
  selectedAccount,
  splitArchived,
  summarizeAccounts,
} from "./accounts-summary";
import type { AccountWithBalance } from "./data/accounts";

let counter = 0;
function account(overrides: Partial<AccountWithBalance>): AccountWithBalance {
  counter += 1;
  return {
    id: `id-${counter}`,
    name: `Cuenta ${counter}`,
    type: "bank",
    closing_day: null,
    due_day: null,
    archived_at: null,
    balance_minor: 0,
    ...overrides,
  };
}

describe("summarizeAccounts", () => {
  it("adds bank and cash as available, inverts the cards as debt and nets them", () => {
    const totals = summarizeAccounts([
      account({ balance_minor: 8425000 }),
      account({ type: "cash", balance_minor: 550000 }),
      account({ type: "credit_card", closing_day: 5, due_day: 12, balance_minor: -2412000 }),
      account({ type: "credit_card", closing_day: 20, due_day: 3, balance_minor: -835000 }),
    ]);
    expect(totals).toEqual({
      available: BigInt(8975000),
      debt: BigInt(3247000),
      net: BigInt(5728000),
    });
  });

  it("does not clamp a card paid in excess: its debt is negative and the net adds up", () => {
    const totals = summarizeAccounts([
      account({ balance_minor: 1000 }),
      account({ type: "credit_card", balance_minor: 400 }),
    ]);
    expect(totals).toEqual({ available: BigInt(1000), debt: BigInt(-400), net: BigInt(1400) });
  });

  it("is exact with amounts at the backend's cap, where a float sum would round", () => {
    const max = 9007199254740991;
    const totals = summarizeAccounts([
      account({ balance_minor: max }),
      account({ type: "cash", balance_minor: max }),
      account({ type: "credit_card", balance_minor: -max }),
    ]);
    expect(totals.available).toBe(BigInt("18014398509481982"));
    expect(totals.debt).toBe(BigInt(max));
    expect(totals.net).toBe(BigInt("9007199254740991"));
  });

  it("leaves the archived accounts out and gives zeros for an empty list", () => {
    expect(
      summarizeAccounts([account({ balance_minor: 500, archived_at: "2026-10-01T00:00:00Z" })]),
    ).toEqual({ available: BigInt(0), debt: BigInt(0), net: BigInt(0) });
    expect(summarizeAccounts([]).net).toBe(BigInt(0));
  });
});

describe("splitArchived and groupAccounts", () => {
  const a = account({});
  const b = account({ archived_at: "2026-10-01T00:00:00Z" });
  const c = account({ type: "credit_card" });
  const d = account({ type: "cash" });

  it("separates the archived accounts and keeps the order", () => {
    expect(splitArchived([a, b, c])).toEqual({ active: [a, c], archived: [b] });
  });

  it("groups bank and cash apart from the cards", () => {
    expect(groupAccounts([a, c, d])).toEqual({ available: [a, d], cards: [c] });
  });
});

describe("selectedAccount", () => {
  const bank = account({});
  const card = account({ type: "credit_card" });
  const active = [card, bank];

  it("picks the account that ?sel names", () => {
    expect(selectedAccount(active, card.id)).toBe(card);
  });

  it("falls back to the first of Disponible without a param, or with an unknown or archived id", () => {
    expect(selectedAccount(active, null)).toBe(bank);
    expect(selectedAccount(active, "nope")).toBe(bank);
    expect(selectedAccount(active, "archived-id")).toBe(bank);
  });

  it("falls back to the first card when there is nothing in Disponible", () => {
    expect(selectedAccount([card], undefined)).toBe(card);
  });

  it("is undefined when there is no active account", () => {
    expect(selectedAccount([], "x")).toBeUndefined();
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { balanceDelta } from "@/lib/core/account-movements";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import type { CategoryRead } from "@/lib/core/data/categories";
import {
  deleteTransaction,
  getTransaction,
  listTransactions,
  restoreTransaction,
  updateTransaction,
  getTransactionsSummary,
  type MovementCreate,
  type MovementListItem,
} from "@/lib/core/data/transactions";
import {
  movedBalance,
  scriptedMovementsApi,
  type Fault,
  type ScriptedCall,
} from "./scripted-movements-api";

// The little backend of the screen and the catalog, now with the movement itself (FE-34, KAN-99).
// It has to answer the way BE-20 does, because the tests of the form, the hook and the screen, and
// what the catalog shows, trust it. The rules it copies are in docs/arquitectura-backend.md §4 and
// `backend/app/modules/transactions/service.py`.

const SPACE = "space-1";

const account = (
  id: string,
  name: string,
  overrides: Partial<AccountWithBalance> = {},
): AccountWithBalance => ({
  id,
  name,
  type: "bank",
  closing_day: null,
  due_day: null,
  archived_at: null,
  balance_minor: 0,
  ...overrides,
});
const ITAU = account("a1", "Itaú");
const BROU = account("a2", "BROU");
const OLD = account("a3", "Vieja", { archived_at: "2026-09-01T10:00:00Z" });

const category = (
  id: string,
  name: string,
  overrides: Partial<CategoryRead> = {},
): CategoryRead => ({
  id,
  name,
  kind: "expense",
  icon: "tag",
  parent_id: null,
  archived_at: null,
  ...overrides,
});
const COMIDA = category("c1", "Comida", { icon: "fork-knife" });
const SUPER = category("c2", "Supermercado", { parent_id: "c1", icon: "shopping-cart" });
const ROPA_OLD = category("c3", "Ropa vieja", { archived_at: "2026-09-01T10:00:00Z" });
const SUELDO = category("c4", "Sueldo", { kind: "income" });

const ref = (a: AccountWithBalance) => ({ id: a.id, name: a.name, type: a.type });

function movement(overrides: Partial<MovementListItem> = {}): MovementListItem {
  return {
    id: "m1",
    type: "expense",
    status: "confirmed",
    date: "2026-10-20",
    description: "Super",
    amount_minor: -10000,
    category: { id: "c2", name: "Supermercado", icon: "shopping-cart", parent: null },
    account: ref(ITAU),
    from_account: null,
    to_account: null,
    balance_after_minor: null,
    ...overrides,
  };
}

const M1 = movement({ id: "m1", date: "2026-10-20" });
const M2 = movement({ id: "m2", date: "2026-10-18", description: "Café", amount_minor: -2500 });
const M3 = movement({ id: "m3", date: "2026-10-10", description: "Cena", amount_minor: -9000 });
const INCOME = movement({
  id: "m4",
  type: "income",
  date: "2026-10-01",
  description: "Sueldo",
  amount_minor: 500000,
  category: { id: "c4", name: "Sueldo", icon: "tag", parent: null },
});
const ADJUSTMENT = movement({
  id: "m5",
  type: "adjustment",
  date: "2026-10-05",
  description: null,
  amount_minor: -30000,
  category: null,
});
const PENDING = movement({ id: "m6", status: "pending", date: "2026-10-06" });
const ON_OLD = movement({ id: "m7", date: "2026-10-07", account: ref(OLD) });
const TRANSFER = movement({
  id: "m8",
  type: "transfer",
  date: "2026-10-08",
  description: "Pase",
  amount_minor: 4000,
  category: null,
  account: null,
  from_account: ref(ITAU),
  to_account: ref(BROU),
});

const ALL = [M1, M2, M3, INCOME, ADJUSTMENT, PENDING, ON_OLD, TRANSFER].sort((a, b) =>
  a.date < b.date ? 1 : -1,
);

function setup(options: { fault?: (call: ScriptedCall) => Fault | undefined } = {}) {
  const items = vi.fn(() => ALL);
  const api = scriptedMovementsApi({
    items,
    accounts: () => [ITAU, BROU, OLD],
    categories: () => [COMIDA, SUPER, ROPA_OLD, SUELDO],
    ...options,
  });
  return { api, items };
}

async function listIds(api: ReturnType<typeof setup>["api"]) {
  const page = await listTransactions(api, SPACE, { month: "2026-10" });
  return page.items.map((item) => item.id);
}

const EXPENSE: MovementCreate = {
  type: "expense",
  account_id: "a1",
  category_id: "c2",
  amount_minor: 10000,
  date: "2026-10-20",
  description: "Super",
};

describe("the size of a page (limit)", () => {
  const MANY = Array.from({ length: 9 }, (_, index) =>
    movement({ id: `n${index + 1}`, date: `2026-10-${String(20 - index).padStart(2, "0")}` }),
  );
  const many = () => scriptedMovementsApi({ items: () => MANY });

  it("gives as many items as asked, the newest first, with the cursor of the next page", async () => {
    const api = many();
    const first = await listTransactions(api, SPACE, {}, null, 6);
    expect(first.items.map((item) => item.id)).toEqual(["n1", "n2", "n3", "n4", "n5", "n6"]);
    expect(first.next_cursor).not.toBeNull();
    const second = await listTransactions(api, SPACE, {}, first.next_cursor, 6);
    expect(second.items.map((item) => item.id)).toEqual(["n7", "n8", "n9"]);
    expect(second.next_cursor).toBeNull();
  });

  it("gives 50 when it is not said, and all of a short list with no cursor", async () => {
    const page = await listTransactions(many(), SPACE, {});
    expect(page.items).toHaveLength(9);
    expect(page.next_cursor).toBeNull();
  });

  it("has no cursor when the page holds exactly what there is", async () => {
    const page = await listTransactions(many(), SPACE, {}, null, 9);
    expect(page.items).toHaveLength(9);
    expect(page.next_cursor).toBeNull();
  });

  it("records the limit in the call, for a test to read", async () => {
    const api = many();
    await listTransactions(api, SPACE, {}, null, 6);
    expect(api.calls[0]).toMatchObject({ kind: "list", query: { limit: 6 } });
  });

  it("answers a 422 on the query for a limit outside 1 to 100, as the real endpoint does", async () => {
    for (const limit of [0, -1, 101, 2.5]) {
      await expect(listTransactions(many(), SPACE, {}, null, limit)).rejects.toMatchObject({
        status: 422,
        body: { detail: [{ loc: ["query", "limit"] }] },
      });
    }
    // The ends are fine.
    await expect(listTransactions(many(), SPACE, {}, null, 1)).resolves.toMatchObject({
      items: [{ id: "n1" }],
    });
    await expect(listTransactions(many(), SPACE, {}, null, 100)).resolves.toBeDefined();
  });
});

describe("the summary of an account (BE-25)", () => {
  it("adds the balance change of the account: every confirmed movement, transfers and adjustments too", async () => {
    const { api } = setup();
    // Itaú in October: -100 - 25 - 90 expenses, +5.000 income, -300 adjustment and -40 of the transfer;
    // the pending one adds nothing and the one on the archived account is not Itaú's.
    const itau = await getTransactionsSummary(api, SPACE, { month: "2026-10", accountId: "a1" });
    expect(itau.balance_change_minor).toBe(-10000 - 2500 - 9000 + 500000 - 30000 - 4000);
    // The transfer arrives at BROU as a plus.
    const brou = await getTransactionsSummary(api, SPACE, { month: "2026-10", accountId: "a2" });
    expect(brou.balance_change_minor).toBe(4000);
  });

  it("does not follow the type filter, as the real one does not", async () => {
    const { api } = setup();
    const expenses = await getTransactionsSummary(api, SPACE, {
      month: "2026-10",
      accountId: "a1",
      type: "expense",
    });
    expect(expenses.balance_change_minor).toBe(-10000 - 2500 - 9000 + 500000 - 30000 - 4000);
    // The income and expense of the summary do follow it.
    expect(expenses.income_minor).toBe(0);
    expect(expenses.expense_minor).toBe(10000 + 2500 + 9000);
  });

  it("is 0 for a month with no movements and for an account that does not exist", async () => {
    const { api } = setup();
    await expect(
      getTransactionsSummary(api, SPACE, { month: "2026-09", accountId: "a1" }),
    ).resolves.toMatchObject({ balance_change_minor: 0 });
    await expect(
      getTransactionsSummary(api, SPACE, { month: "2026-10", accountId: "nope" }),
    ).resolves.toMatchObject({ balance_change_minor: 0 });
  });

  it("is null without an account", async () => {
    const { api } = setup();
    const summary = await getTransactionsSummary(api, SPACE, { month: "2026-10" });
    expect(summary.balance_change_minor).toBeNull();
  });
});

describe("the rule of the fake for the balance, and the app's (BE-25)", () => {
  // The fake adds up balances (`balance_change_minor` of the summary and the running balance of the
  // catalog's demo) with its own rule, written apart from `balanceDelta` of the app. If it borrowed
  // that one, a mistake of sign in it would be repeated by the fake and no test would notice. Here
  // both are held against the same cases and against the numbers a person would write by hand.
  const VISA = account("a9", "Visa", { type: "credit_card" });
  const transfer = (from: AccountWithBalance, to: AccountWithBalance, amount = 4000) =>
    movement({
      type: "transfer",
      description: "Pase",
      amount_minor: amount,
      category: null,
      account: null,
      from_account: ref(from),
      to_account: ref(to),
    });
  const onCard = (overrides: Partial<MovementListItem>) =>
    movement({ account: ref(VISA), ...overrides });

  // [name, movement, the account asked about, what it moved the balance of that account]
  const CASES: [string, MovementListItem, string, number][] = [
    [
      "an outgoing transfer takes it off the account it comes from",
      transfer(ITAU, BROU),
      "a1",
      -4000,
    ],
    ["an incoming transfer puts it in the account it goes to", transfer(ITAU, BROU), "a2", 4000],
    ["a transfer does nothing to a third account", transfer(ITAU, BROU), "a3", 0],
    [
      "a payment received puts it in the card (its debt falls)",
      transfer(ITAU, VISA, 1850000),
      "a9",
      1850000,
    ],
    ["a payment received takes it off the bank", transfer(ITAU, VISA, 1850000), "a1", -1850000],
    [
      "a transfer out of a card takes it off the card (its debt grows)",
      transfer(VISA, ITAU, 100000),
      "a9",
      -100000,
    ],
    [
      "an adjustment up",
      movement({ type: "adjustment", amount_minor: 8500000, category: null }),
      "a1",
      8500000,
    ],
    [
      "an adjustment down",
      movement({ type: "adjustment", amount_minor: -30000, category: null }),
      "a1",
      -30000,
    ],
    [
      "an adjustment of a card that lowers the debt",
      onCard({ type: "adjustment", amount_minor: 2500000, category: null }),
      "a9",
      2500000,
    ],
    [
      "an adjustment of a card that raises the debt",
      onCard({ type: "adjustment", amount_minor: -2500000, category: null }),
      "a9",
      -2500000,
    ],
    [
      "a purchase on a card makes the balance more negative",
      onCard({ amount_minor: -234000 }),
      "a9",
      -234000,
    ],
    [
      "a refund (an income) on a card raises it",
      onCard({ type: "income", amount_minor: 50000 }),
      "a9",
      50000,
    ],
    ["an expense of the bank", movement({ amount_minor: -10000 }), "a1", -10000],
    ["an income of the bank", movement({ type: "income", amount_minor: 500000 }), "a1", 500000],
    [
      "a movement of another account does nothing to this one",
      movement({ amount_minor: -10000 }),
      "a2",
      0,
    ],
    [
      "the biggest amount, exact",
      movement({ amount_minor: -Number.MAX_SAFE_INTEGER }),
      "a1",
      -Number.MAX_SAFE_INTEGER,
    ],
  ];

  it.each(CASES)("%s", (_name, item, accountId, expected) => {
    expect(movedBalance(item, accountId)).toBe(BigInt(expected));
    // The same answer from the app's rule: if either one is wrong, they stop agreeing.
    expect(balanceDelta(item, accountId)).toBe(BigInt(expected));
    expect(movedBalance(item, accountId)).toBe(balanceDelta(item, accountId));
  });

  it("takes the sign from the type, as the backend does, not from the number it came with", () => {
    for (const amount of [10000, -10000]) {
      const expense = movement({ amount_minor: amount });
      const income = movement({ type: "income", amount_minor: amount });
      expect(movedBalance(expense, "a1")).toBe(BigInt(-10000));
      expect(movedBalance(income, "a1")).toBe(BigInt(10000));
      expect(movedBalance(expense, "a1")).toBe(balanceDelta(expense, "a1"));
      expect(movedBalance(income, "a1")).toBe(balanceDelta(income, "a1"));
    }
  });

  it("is what the summary adds up as the balance change of an account, whatever the type filter says", async () => {
    const items = [
      transfer(ITAU, BROU, 4000),
      movement({ id: "x1", date: "2026-10-03", amount_minor: -10000 }),
      movement({ id: "x2", type: "income", date: "2026-10-02", amount_minor: 500000 }),
      movement({
        id: "x3",
        type: "adjustment",
        date: "2026-10-01",
        amount_minor: -30000,
        category: null,
      }),
      movement({ id: "x4", status: "pending", date: "2026-10-04", amount_minor: -999 }),
    ];
    const api = scriptedMovementsApi({ items: () => items, accounts: () => [ITAU, BROU, OLD] });
    const itau = await getTransactionsSummary(api, SPACE, { accountId: "a1", month: "2026-10" });
    expect(itau.balance_change_minor).toBe(-4000 - 10000 + 500000 - 30000);
    const typed = await getTransactionsSummary(api, SPACE, {
      accountId: "a1",
      month: "2026-10",
      type: "income",
    });
    expect(typed.balance_change_minor).toBe(itau.balance_change_minor);
    const brou = await getTransactionsSummary(api, SPACE, { accountId: "a2", month: "2026-10" });
    expect(brou.balance_change_minor).toBe(4000);
  });

  it("does not import, nor name, the app's rule: the fake and the demo that use it are checked apart", () => {
    // A module whose path ends in `lib/core/account-movements`, taken by a static import, a side-effect
    // import, a re-export, a dynamic `import()` or a `require()`. The component of the same name in
    // `app/cuentas/_components/` is not it.
    const IMPORTS_APP_RULE =
      /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'][^"']*lib\/core\/account-movements(?:\.[jt]sx?)?["']/;
    const NAMES_APP_RULE = /\bbalanceDelta\b/;

    // The guard itself, so it cannot go quiet by a mistake of its own.
    for (const hit of [
      'import { balanceDelta } from "@/lib/core/account-movements";',
      "import * as rule from '../../lib/core/account-movements.ts';",
      'import "@/lib/core/account-movements";',
      'export { balanceDelta } from "@/lib/core/account-movements";',
      'const rule = await import("@/lib/core/account-movements");',
      "const rule = require('@/lib/core/account-movements');",
    ]) {
      expect(hit, hit).toMatch(IMPORTS_APP_RULE);
    }
    for (const miss of [
      'import { AccountMovements } from "@/app/cuentas/_components/account-movements";',
      'import { AccountMovementsTable } from "./account-movements-table";',
      'const screen = await import("@/app/cuentas/_components/account-movements");',
      'import { movedBalance } from "@/components/movements/scripted-movements-api";',
    ]) {
      expect(miss, miss).not.toMatch(IMPORTS_APP_RULE);
    }
    expect("total += balanceDelta(item, id);").toMatch(NAMES_APP_RULE);
    expect("total += movedBalance(item, id);").not.toMatch(NAMES_APP_RULE);

    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    for (const file of [
      "./scripted-movements-api.ts",
      "../../app/catalog/_components/account-detail-demos.tsx",
    ]) {
      const source = read(file);
      expect(source, `${file} imports the app's rule`).not.toMatch(IMPORTS_APP_RULE);
      expect(source, `${file} names balanceDelta`).not.toMatch(NAMES_APP_RULE);
    }
  });
});

describe("GET of one movement", () => {
  it("answers the movement as the list has it", async () => {
    const { api } = setup();
    await expect(getTransaction(api, SPACE, "m1")).resolves.toEqual(M1);
    expect(api.calls.at(-1)).toMatchObject({ kind: "detail", id: "m1" });
  });

  it("is a 404 transaction_not_found for an id that does not exist", async () => {
    const { api } = setup();
    await expect(getTransaction(api, SPACE, "nope")).rejects.toMatchObject({
      status: 404,
      body: { code: "transaction_not_found" },
    });
  });

  it("is the same 404 for a deleted one", async () => {
    const { api } = setup();
    await deleteTransaction(api, SPACE, "m1");
    await expect(getTransaction(api, SPACE, "m1")).rejects.toMatchObject({ status: 404 });
  });

  it("shows an adjustment, a pending one and one of an archived account: it is the detail that is read only", async () => {
    const { api } = setup();
    for (const item of [ADJUSTMENT, PENDING, ON_OLD]) {
      await expect(getTransaction(api, SPACE, item.id)).resolves.toEqual(item);
    }
  });
});

describe("DELETE", () => {
  it("is soft: it leaves the list and the summary, and the caller's items are not written", async () => {
    const { api, items } = setup();
    expect(await listIds(api)).toContain("m2");
    const before = (await getTransactionsSummary(api, SPACE, { month: "2026-10" })).count;
    await expect(deleteTransaction(api, SPACE, "m2")).resolves.toBeUndefined();
    expect(await listIds(api)).not.toContain("m2");
    expect((await getTransactionsSummary(api, SPACE, { month: "2026-10" })).count).toBe(before - 1);
    expect(api.deleted.has("m2")).toBe(true);
    expect(items()).toBe(ALL);
    expect(ALL.map((item) => item.id)).toContain("m2");
  });

  it("deleting twice is a 204 that changes nothing", async () => {
    const { api } = setup();
    await deleteTransaction(api, SPACE, "m2");
    await expect(deleteTransaction(api, SPACE, "m2")).resolves.toBeUndefined();
    expect([...api.deleted]).toEqual(["m2"]);
  });

  it("is a 404 for an id that does not exist", async () => {
    const { api } = setup();
    await expect(deleteTransaction(api, SPACE, "nope")).rejects.toMatchObject({ status: 404 });
  });

  it("is a 409 transaction_not_editable for an adjustment and a pending movement, and deletes nothing", async () => {
    const { api } = setup();
    for (const id of ["m5", "m6"]) {
      await expect(deleteTransaction(api, SPACE, id)).rejects.toMatchObject({
        status: 409,
        body: { code: "transaction_not_editable" },
      });
    }
    expect(api.deleted.size).toBe(0);
  });

  it("is a 409 account_archived when an account of the movement is archived", async () => {
    const { api } = setup();
    await expect(deleteTransaction(api, SPACE, "m7")).rejects.toMatchObject({
      status: 409,
      body: { code: "account_archived" },
    });
    expect(api.deleted.size).toBe(0);
  });
});

describe("restore", () => {
  it("brings the movement back to the list, identical, and to the summary", async () => {
    const { api } = setup();
    await deleteTransaction(api, SPACE, "m1");
    expect(await listIds(api)).not.toContain("m1");
    await expect(restoreTransaction(api, SPACE, "m1")).resolves.toEqual(M1);
    expect(await listIds(api)).toContain("m1");
    expect(api.deleted.size).toBe(0);
    // Same place in the list: it is not at the end.
    expect((await listIds(api)).indexOf("m1")).toBe(0);
  });

  it("restoring one that is not deleted is a 200 that changes nothing", async () => {
    const { api } = setup();
    await expect(restoreTransaction(api, SPACE, "m1")).resolves.toEqual(M1);
    expect(api.deleted.size).toBe(0);
  });

  it("is a 404 for an id that does not exist, and a 409 for an adjustment", async () => {
    const { api } = setup();
    await expect(restoreTransaction(api, SPACE, "nope")).rejects.toMatchObject({ status: 404 });
    await expect(restoreTransaction(api, SPACE, "m5")).rejects.toMatchObject({
      status: 409,
      body: { code: "transaction_not_editable" },
    });
  });

  it("is a 409 account_archived if the account was archived after the delete, and it stays deleted", async () => {
    let archived = false;
    const api = scriptedMovementsApi({
      items: () => ALL,
      accounts: () => [
        archived ? { ...ITAU, archived_at: "2026-10-21T10:00:00Z" } : ITAU,
        BROU,
        OLD,
      ],
      categories: () => [COMIDA, SUPER],
    });
    await deleteTransaction(api, SPACE, "m1");
    archived = true;
    await expect(restoreTransaction(api, SPACE, "m1")).rejects.toMatchObject({
      status: 409,
      body: { code: "account_archived" },
    });
    expect(api.deleted.has("m1")).toBe(true);
  });
});

describe("PUT", () => {
  it("replaces the movement: the list, the detail and the summary show the new one", async () => {
    const { api } = setup();
    const saved = await updateTransaction(api, SPACE, "m1", {
      ...EXPENSE,
      amount_minor: 40050,
      description: "Super grande",
      account_id: "a2",
    });
    expect(saved).toMatchObject({
      id: "m1",
      type: "expense",
      status: "confirmed",
      description: "Super grande",
      amount_minor: -40050,
      account: { id: "a2", name: "BROU", type: "bank" },
      category: { id: "c2", name: "Supermercado" },
    });
    await expect(getTransaction(api, SPACE, "m1")).resolves.toEqual(saved);
    const page = await listTransactions(api, SPACE, { month: "2026-10" });
    expect(page.items.find((item) => item.id === "m1")).toEqual(saved);
    const summary = await getTransactionsSummary(api, SPACE, { month: "2026-10" });
    // The pending one and the adjustment do not count; the one on the archived account does.
    expect(summary.expense_minor).toBe(40050 + 2500 + 9000 + 10000);
  });

  it("gives an income its positive sign and a transfer no category", async () => {
    const { api } = setup();
    const income = await updateTransaction(api, SPACE, "m4", {
      type: "income",
      account_id: "a1",
      category_id: "c4",
      amount_minor: 600000,
      date: "2026-10-01",
    });
    expect(income.amount_minor).toBe(600000);
    expect(income.description).toBeNull();
    const transfer = await updateTransaction(api, SPACE, "m8", {
      type: "transfer",
      from_account_id: "a2",
      to_account_id: "a1",
      amount_minor: 1,
      date: "2026-10-08",
    });
    expect(transfer).toMatchObject({
      category: null,
      account: null,
      from_account: { id: "a2" },
      to_account: { id: "a1" },
    });
  });

  it("clears the note when the body leaves the description out (the PUT replaces the whole movement)", async () => {
    const { api } = setup();
    const { description, ...without } = EXPENSE;
    void description;
    const saved = await updateTransaction(api, SPACE, "m1", without);
    expect(saved.description).toBeNull();
  });

  it("keeps the list newest first when the date changes, and equal dates in the order they had", async () => {
    const { api } = setup();
    await updateTransaction(api, SPACE, "m3", { ...EXPENSE, date: "2026-10-25" });
    const ids = await listIds(api);
    expect(ids[0]).toBe("m3");
    expect(ids.slice(1, 3)).toEqual(["m1", "m2"]);
    await updateTransaction(api, SPACE, "m3", { ...EXPENSE, date: "2026-10-20" });
    expect((await listIds(api)).slice(0, 2)).toEqual(["m1", "m3"]);
  });

  it("is a 404 for an unknown or deleted one, and a 409 for an adjustment or a pending one", async () => {
    const { api } = setup();
    await expect(updateTransaction(api, SPACE, "nope", EXPENSE)).rejects.toMatchObject({
      status: 404,
    });
    await deleteTransaction(api, SPACE, "m2");
    await expect(updateTransaction(api, SPACE, "m2", EXPENSE)).rejects.toMatchObject({
      status: 404,
    });
    for (const id of ["m5", "m6"]) {
      await expect(updateTransaction(api, SPACE, id, EXPENSE)).rejects.toMatchObject({
        status: 409,
        body: { code: "transaction_not_editable" },
      });
    }
  });

  it("is a 409 account_archived when the movement already is on an archived account", async () => {
    const { api } = setup();
    await expect(updateTransaction(api, SPACE, "m7", EXPENSE)).rejects.toMatchObject({
      status: 409,
      body: { code: "account_archived" },
    });
  });

  it("is a 422 on the field, with the type in the loc, for an account of the body that is archived or unknown", async () => {
    const { api } = setup();
    await expect(
      updateTransaction(api, SPACE, "m1", { ...EXPENSE, account_id: "a3" }),
    ).rejects.toMatchObject({
      status: 422,
      body: { detail: [{ type: "account_archived", loc: ["body", "expense", "account_id"] }] },
    });
    await expect(
      updateTransaction(api, SPACE, "m1", { ...EXPENSE, account_id: "zzz" }),
    ).rejects.toMatchObject({
      status: 422,
      body: { detail: [{ type: "account_not_found", loc: ["body", "expense", "account_id"] }] },
    });
    await expect(
      updateTransaction(api, SPACE, "m8", {
        type: "transfer",
        from_account_id: "a1",
        to_account_id: "a3",
        amount_minor: 1,
        date: "2026-10-08",
      }),
    ).rejects.toMatchObject({
      status: 422,
      body: { detail: [{ loc: ["body", "transfer", "to_account_id"] }] },
    });
  });

  it("is a 422 for a category that does not exist, and for an archived one the movement does not already have", async () => {
    const { api } = setup();
    await expect(
      updateTransaction(api, SPACE, "m1", { ...EXPENSE, category_id: "zzz" }),
    ).rejects.toMatchObject({
      body: { detail: [{ type: "category_not_found", loc: ["body", "expense", "category_id"] }] },
    });
    await expect(
      updateTransaction(api, SPACE, "m1", { ...EXPENSE, category_id: "c3" }),
    ).rejects.toMatchObject({
      status: 422,
      body: { detail: [{ type: "category_archived" }] },
    });
  });

  it("accepts the archived category the movement already has (old movements keep theirs)", async () => {
    const withOld = movement({
      id: "m9",
      date: "2026-10-09",
      category: { id: "c3", name: "Ropa vieja", icon: "tag", parent: null },
    });
    const api = scriptedMovementsApi({
      items: () => [withOld],
      accounts: () => [ITAU],
      categories: () => [ROPA_OLD],
    });
    const saved = await updateTransaction(api, SPACE, "m9", { ...EXPENSE, category_id: "c3" });
    expect(saved.category).toMatchObject({ id: "c3", name: "Ropa vieja" });
  });

  it("gives a subcategory its principal", async () => {
    const { api } = setup();
    const saved = await updateTransaction(api, SPACE, "m1", { ...EXPENSE, category_id: "c2" });
    expect(saved.category).toEqual({
      id: "c2",
      name: "Supermercado",
      icon: "shopping-cart",
      parent: { id: "c1", name: "Comida", icon: "fork-knife" },
    });
  });

  it("records the body it was sent, for a test to read", async () => {
    const { api } = setup();
    await updateTransaction(api, SPACE, "m1", EXPENSE);
    expect(api.calls.at(-1)).toMatchObject({ kind: "update", id: "m1", body: EXPENSE });
  });
});

describe("what goes wrong, by request", () => {
  async function failing(
    fault: Fault,
    run: (api: ReturnType<typeof setup>["api"]) => Promise<unknown>,
  ) {
    const { api } = setup({
      fault: (call) =>
        ["detail", "update", "delete", "restore"].includes(call.kind) ? fault : undefined,
    });
    return run(api).then(
      () => null,
      (error: unknown) => error,
    );
  }

  it("not-found answers a 404 whatever the movement is, for the four requests", async () => {
    for (const run of [
      (api: ReturnType<typeof setup>["api"]) => getTransaction(api, SPACE, "m1"),
      (api: ReturnType<typeof setup>["api"]) => updateTransaction(api, SPACE, "m1", EXPENSE),
      (api: ReturnType<typeof setup>["api"]) => deleteTransaction(api, SPACE, "m1"),
      (api: ReturnType<typeof setup>["api"]) => restoreTransaction(api, SPACE, "m1"),
    ]) {
      expect(await failing("not-found", run)).toMatchObject({
        status: 404,
        body: { code: "transaction_not_found" },
      });
    }
  });

  it("not-editable and account-archived answer the 409s on an ordinary movement", async () => {
    expect(
      await failing("not-editable", (api) => deleteTransaction(api, SPACE, "m1")),
    ).toMatchObject({
      status: 409,
      body: { code: "transaction_not_editable" },
    });
    expect(
      await failing("account-archived", (api) => updateTransaction(api, SPACE, "m1", EXPENSE)),
    ).toMatchObject({ status: 409, body: { code: "account_archived" } });
  });

  it("server, invalid and offline: a 500, a 422 (on the body of a PUT, on the id of the rest) and a rejected fetch", async () => {
    expect(await failing("server", (api) => getTransaction(api, SPACE, "m1"))).toMatchObject({
      status: 500,
    });
    expect(
      await failing("invalid", (api) => updateTransaction(api, SPACE, "m1", EXPENSE)),
    ).toMatchObject({
      status: 422,
      body: { detail: [{ loc: ["body", "expense", "amount_minor"] }] },
    });
    expect(await failing("invalid", (api) => deleteTransaction(api, SPACE, "m1"))).toMatchObject({
      status: 422,
      body: { detail: [{ loc: ["path", "transaction_id"] }] },
    });
    expect(await failing("offline", (api) => restoreTransaction(api, SPACE, "m1"))).toBeInstanceOf(
      TypeError,
    );
  });

  it("a fault that is not for a movement leaves its requests alone, and the list ignores the ones that are", async () => {
    const { api } = setup({ fault: () => "not-found" });
    await expect(listTransactions(api, SPACE, { month: "2026-10" })).resolves.toMatchObject({
      items: expect.any(Array),
    });
    await expect(getTransactionsSummary(api, SPACE, {})).resolves.toMatchObject({ count: 8 });
  });

  it("waits for the delay and never answers a request that 'never' answers", async () => {
    vi.useFakeTimers();
    try {
      const { api } = setup({ fault: (call) => (call.kind === "delete" ? "never" : undefined) });
      const settled = vi.fn();
      void deleteTransaction(api, SPACE, "m1").then(settled, settled);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(settled).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("delays by kind of request", async () => {
    vi.useFakeTimers();
    try {
      const api = scriptedMovementsApi({
        items: () => ALL,
        delay: (call) => (call.kind === "delete" ? 500 : 0),
      });
      const settled = vi.fn();
      void deleteTransaction(api, SPACE, "m1").then(settled);
      await vi.advanceTimersByTimeAsync(499);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      expect(settled).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("what it does not script", () => {
  it("throws on a POST that is not a restore: creating movements is not its job", () => {
    const { api } = setup();
    expect(() =>
      (api as unknown as { POST: (path: string) => unknown }).POST(
        "/spaces/{space_id}/transactions",
      ),
    ).toThrow(/no POST/);
  });
});

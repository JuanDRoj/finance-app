import { describe, expect, it, vi } from "vitest";
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
import { scriptedMovementsApi, type Fault, type ScriptedCall } from "./scripted-movements-api";

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

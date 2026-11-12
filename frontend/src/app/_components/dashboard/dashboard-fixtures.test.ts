import { describe, expect, it } from "vitest";
import { summarizeAccounts } from "@/lib/core/accounts-summary";
import { hasHistory } from "@/lib/core/dashboard";
import { shiftMonth } from "@/lib/core/movements";
import {
  DASHBOARD_SCENARIOS,
  SCENARIO_LIST,
  type DashboardScenario,
  type ScenarioId,
} from "./dashboard-fixtures";

// The cases the dashboard is tried with are data, and a test and a catalog trust them: they must be
// what they say. Here the app's own rules (`summarizeAccounts`, `hasHistory`) check them from outside.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

const ALL = SCENARIO_LIST;
const scenario = (id: ScenarioId): DashboardScenario => DASHBOARD_SCENARIOS[id];
const length = (text: string) => Array.from(text).length;

/** Every amount of a scenario: the dashboard's, the top's, the series', the accounts' and the movements'. */
function amountsOf(s: DashboardScenario): number[] {
  const { dashboard } = s;
  return [
    dashboard.available_minor,
    dashboard.card_debt_minor,
    dashboard.net_minor,
    dashboard.month_expense_minor,
    ...dashboard.top_expense_categories.map((row) => row.amount_minor),
    ...s.series.flatMap((p) => [p.income_minor, p.expense_minor, p.net_minor]),
    ...s.accounts.map((a) => a.balance_minor),
    ...s.movements.map((m) => m.amount_minor),
  ];
}

describe("every scenario", () => {
  it("is listed once, under its own id, in the order of the selector", () => {
    expect(SCENARIO_LIST.map((s) => s.id)).toEqual(Object.keys(DASHBOARD_SCENARIOS));
    for (const [id, s] of Object.entries(DASHBOARD_SCENARIOS)) expect(s.id).toBe(id);
    expect(new Set(SCENARIO_LIST.map((s) => s.label)).size).toBe(SCENARIO_LIST.length);
  });

  it.each(ALL.map((s) => [s.id, s] as const))(
    "%s: six consecutive months that end in the current one, oldest first",
    (_id, s) => {
      expect(s.series).toHaveLength(6);
      expect(s.series.at(-1)?.month).toBe(s.dashboard.month);
      expect(s.today.startsWith(s.dashboard.month)).toBe(true);
      for (let index = 1; index < s.series.length; index += 1) {
        expect(shiftMonth(s.series[index - 1]!.month, 1)).toBe(s.series[index]!.month);
      }
    },
  );

  it.each(ALL.map((s) => [s.id, s] as const))(
    "%s: the last month of the series is the dashboard's (the net of today and the month's expenses)",
    (_id, s) => {
      const last = s.series.at(-1)!;
      expect(last.net_minor).toBe(s.dashboard.net_minor);
      expect(last.expense_minor).toBe(s.dashboard.month_expense_minor);
    },
  );

  it.each(ALL.map((s) => [s.id, s] as const))(
    "%s: Disponible, Deuda and Neto are the sum of its accounts",
    (_id, s) => {
      const totals = summarizeAccounts(s.accounts);
      expect(BigInt(s.dashboard.available_minor)).toBe(totals.available);
      expect(BigInt(s.dashboard.card_debt_minor)).toBe(totals.debt);
      expect(BigInt(s.dashboard.net_minor)).toBe(totals.net);
    },
  );

  it.each(ALL.map((s) => [s.id, s] as const))(
    "%s: the top is at most 5 main categories, largest first, inside the month's expenses",
    (_id, s) => {
      const top = s.dashboard.top_expense_categories;
      expect(top.length).toBeLessThanOrEqual(5);
      const amounts = top.map((row) => BigInt(row.amount_minor));
      expect(amounts).toEqual([...amounts].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)));
      const sum = amounts.reduce((total, amount) => total + amount, BigInt(0));
      expect(sum <= BigInt(s.dashboard.month_expense_minor)).toBe(true);
      for (const row of top) expect(row.category_id).toMatch(UUID);
      expect(new Set(top.map((row) => row.category_id)).size).toBe(top.length);
    },
  );

  it.each(ALL.map((s) => [s.id, s] as const))(
    "%s: each percentage is a whole percent of the month's expenses, rounded to the nearest with the half up",
    (_id, s) => {
      const total = BigInt(s.dashboard.month_expense_minor);
      for (const row of s.dashboard.top_expense_categories) {
        const exact = (BigInt(200) * BigInt(row.amount_minor) + total) / (BigInt(2) * total);
        expect(row.percentage).toBe(Number(exact));
      }
    },
  );

  it.each(ALL.map((s) => [s.id, s] as const))(
    "%s: its accounts, movements and categories have UUIDs, so the links to Movimientos work",
    (_id, s) => {
      const ids = [...s.accounts.map((a) => a.id), ...s.movements.map((m) => m.id)];
      for (const id of ids) expect(id).toMatch(UUID);
      expect(new Set(ids).size).toBe(ids.length);
      for (const m of s.movements) {
        if (m.category) expect(m.category.id).toMatch(UUID);
      }
    },
  );

  it.each(ALL.map((s) => [s.id, s] as const))(
    "%s: the movements come newest first, income and expense are never negative in the series",
    (_id, s) => {
      const dates = s.movements.map((m) => m.date);
      expect(dates).toEqual([...dates].sort().reverse());
      for (const p of s.series) {
        expect(p.income_minor).toBeGreaterThanOrEqual(0);
        expect(p.expense_minor).toBeGreaterThanOrEqual(0);
      }
    },
  );

  it.each(ALL.map((s) => [s.id, s] as const))(
    "%s: every amount is an integer, and the names and descriptions are within the backend's limits",
    (_id, s) => {
      for (const amount of amountsOf(s)) expect(Number.isInteger(amount)).toBe(true);
      for (const row of s.dashboard.top_expense_categories) {
        expect(length(row.name)).toBeLessThanOrEqual(80);
      }
      for (const a of s.accounts) expect(length(a.name)).toBeLessThanOrEqual(80);
      for (const m of s.movements) expect(length(m.description ?? "")).toBeLessThanOrEqual(200);
    },
  );
});

describe("the canvas", () => {
  const canvas = scenario("canvas");

  it("has the figures of K-V2-Escritorio, in the minor unit of the peso", () => {
    expect(canvas.dashboard).toMatchObject({
      month: "2026-10",
      available_minor: 12_890_000,
      card_debt_minor: 3_247_000,
      net_minor: 9_643_000,
      month_expense_minor: 3_677_000,
    });
    expect(
      canvas.dashboard.top_expense_categories.map((row) => [row.name, row.percentage]),
    ).toEqual([
      ["Comida", 58],
      ["Transporte", 17],
      ["Hogar", 13],
      ["Salud", 7],
      ["Ocio", 5],
    ]);
    expect(canvas.series.map((p) => p.net_minor)).toEqual([
      7_120_000, 7_690_000, 8_140_000, 8_830_000, 9_210_000, 9_643_000,
    ]);
    expect(canvas.today).toBe("2026-10-21");
  });

  it("has five accounts: two banks, cash and two cards", () => {
    expect(canvas.accounts.map((a) => a.type)).toEqual([
      "bank",
      "bank",
      "cash",
      "credit_card",
      "credit_card",
    ]);
  });

  it("has more than six movements, so 'Últimos movimientos' has to cut", () => {
    expect(canvas.movements.length).toBeGreaterThan(6);
  });
});

describe("the cases", () => {
  it("one-month has no history, and the others of the canvas do", () => {
    expect(hasHistory(scenario("one-month").series)).toBe(false);
    expect(hasHistory(scenario("canvas").series)).toBe(true);
    expect(hasHistory(scenario("no-expenses").series)).toBe(true);
  });

  it("no-expenses has an empty top and no expenses this month, with a month before that had them", () => {
    const s = scenario("no-expenses");
    expect(s.dashboard.top_expense_categories).toEqual([]);
    expect(s.dashboard.month_expense_minor).toBe(0);
    expect(s.series.at(-2)?.expense_minor).toBeGreaterThan(0);
  });

  it("no-movements has accounts at 0, no history and nothing to list", () => {
    const s = scenario("no-movements");
    expect(s.accounts.length).toBeGreaterThan(0);
    expect(s.accounts.every((a) => a.balance_minor === 0)).toBe(true);
    expect(s.movements).toEqual([]);
    expect(hasHistory(s.series)).toBe(false);
    expect(s.series.every((p) => p.income_minor === 0 && p.expense_minor === 0)).toBe(true);
  });

  it("negative-net owes more than it has, and the series goes below zero", () => {
    const s = scenario("negative-net");
    expect(s.dashboard.net_minor).toBeLessThan(0);
    expect(s.series.some((p) => p.net_minor < 0)).toBe(true);
  });

  it("at-the-limit reaches the largest amount the backend takes, still exact", () => {
    const amounts = amountsOf(scenario("at-the-limit"));
    expect(amounts).toContain(MAX_SAFE);
    expect(amounts.every((amount) => Number.isSafeInteger(amount))).toBe(true);
  });

  it("beyond-the-limit has sums that are no longer safe integers, and each single amount still is", () => {
    const s = scenario("beyond-the-limit");
    expect(Number.isSafeInteger(s.dashboard.available_minor)).toBe(false);
    expect(Number.isSafeInteger(s.dashboard.net_minor)).toBe(false);
    expect(Number.isSafeInteger(s.dashboard.month_expense_minor)).toBe(false);
    expect(s.accounts.every((a) => Number.isSafeInteger(a.balance_minor))).toBe(true);
    expect(s.movements.every((m) => Number.isSafeInteger(m.amount_minor))).toBe(true);
  });

  it("worst-case reaches the limits of the backend: 80-character names, 200-character descriptions, the largest amount", () => {
    const s = scenario("worst-case");
    const names = [
      ...s.dashboard.top_expense_categories.map((row) => row.name),
      ...s.accounts.map((a) => a.name),
    ];
    expect(names.filter((name) => length(name) === 80).length).toBeGreaterThanOrEqual(6);
    const descriptions = s.movements.map((m) => m.description ?? "");
    expect(descriptions.filter((text) => length(text) === 200)).toHaveLength(4);
    expect(amountsOf(s)).toContain(MAX_SAFE);
    // The four writings the screen has to hold: with spaces, with none, emoji and Arabic.
    expect(descriptions.some((text) => /\s/.test(text))).toBe(true);
    expect(descriptions.some((text) => text.length > 0 && !/\s/.test(text))).toBe(true);
    expect(descriptions.some((text) => /\p{Extended_Pictographic}/u.test(text))).toBe(true);
    expect(descriptions.some((text) => /\p{Script=Arabic}/u.test(text))).toBe(true);
    // Some percentages round to 0, and the amounts are as far apart as a bar can show.
    expect(s.dashboard.top_expense_categories.map((row) => row.percentage)).toContain(0);
  });

  it("many-accounts has 40 active accounts of the three types", () => {
    const s = scenario("many-accounts");
    expect(s.accounts).toHaveLength(40);
    expect(new Set(s.accounts.map((a) => a.type))).toEqual(
      new Set(["bank", "cash", "credit_card"]),
    );
    expect(s.accounts.every((a) => a.archived_at === null)).toBe(true);
  });

  it("exponent-0 and exponent-3 are the canvas in other currencies, with the same percentages", () => {
    const canvas = scenario("canvas");
    const clp = scenario("exponent-0");
    const bhd = scenario("exponent-3");
    expect(clp.currency).toEqual({ code: "CLP", exponent: 0 });
    expect(bhd.currency).toEqual({ code: "BHD", exponent: 3 });
    expect(clp.dashboard.net_minor).toBe(canvas.dashboard.net_minor / 100);
    expect(bhd.dashboard.net_minor).toBe(canvas.dashboard.net_minor * 10);
    const percentages = (s: DashboardScenario) =>
      s.dashboard.top_expense_categories.map((row) => row.percentage);
    expect(percentages(clp)).toEqual(percentages(canvas));
    expect(percentages(bhd)).toEqual(percentages(canvas));
  });
});

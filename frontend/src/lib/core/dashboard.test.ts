import { describe, expect, it } from "vitest";
import {
  EXPENSE_COMPARISON_FROM_DAY,
  MIN_BAR_PERCENT,
  compareExpense,
  describeAvailableNote,
  describeDebtNote,
  describeIncomeExpenseChartLabel,
  describeMonthSavings,
  describeNetChange,
  describeNetChartLabel,
  expensesHref,
  formatCompactMoney,
  formatDashboardAmount,
  formatMonthShort,
  formatPercent,
  hasHistory,
  hasIncomeOrExpense,
  niceTicks,
  topBarWidths,
  topCategoryHref,
} from "./dashboard";
import type { AccountWithBalance } from "./data/accounts";
import type { MonthlySeriesPoint } from "./data/dashboard";
import { parseMovementFilters } from "./movements";

// The logic of the Inicio's dashboard (FE-35). The proyecto "unit" runs with TZ=America/Montevideo.
// Amounts are compared with NBSP (\u00A0) between the sign and the figure and the typographic minus
// (\u2212), written as escapes.

const UYU = { code: "UYU", exponent: 2 };
const CLP = { code: "CLP", exponent: 0 };
const KWD = { code: "KWD", exponent: 3 };

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function point(month: string, income: number, expense: number, net: number): MonthlySeriesPoint {
  return { month, income_minor: income, expense_minor: expense, net_minor: net };
}

// The six months of the canvas (K-V2-Escritorio), in the minor unit of the peso.
const CANVAS: MonthlySeriesPoint[] = [
  point("2026-05", 6500000, 4120000, 7120000),
  point("2026-06", 6500000, 3890000, 7690000),
  point("2026-07", 7250000, 4430000, 8140000),
  point("2026-08", 6500000, 3560000, 8830000),
  point("2026-09", 6800000, 3980000, 9210000),
  point("2026-10", 6800000, 3677000, 9643000),
];

/** A series of six months where only the last one has anything: the first month of use. */
const ONE_MONTH: MonthlySeriesPoint[] = [
  point("2026-05", 0, 0, 0),
  point("2026-06", 0, 0, 0),
  point("2026-07", 0, 0, 0),
  point("2026-08", 0, 0, 0),
  point("2026-09", 0, 0, 0),
  point("2026-10", 6800000, 3677000, 9643000),
];

function account(overrides: Partial<AccountWithBalance>): AccountWithBalance {
  return {
    id: "a",
    name: "Cuenta",
    type: "bank",
    balance_minor: 0,
    closing_day: null,
    due_day: null,
    archived_at: null,
    ...overrides,
  };
}

describe("formatDashboardAmount", () => {
  it("is formatMoney for an amount that is exact", () => {
    expect(formatDashboardAmount(155050, UYU)).toBe("$\u00A01.550,50");
    expect(formatDashboardAmount(-155050, UYU)).toBe("\u2212$\u00A01.550,50");
    expect(formatDashboardAmount(0, UYU)).toBe("$\u00A00,00");
    expect(formatDashboardAmount(433000, UYU, { sign: "exceptZero" })).toBe("+$\u00A04.330,00");
  });

  it("writes the largest exact amount in full, with 0, 2 and 3 decimals", () => {
    expect(formatDashboardAmount(MAX_SAFE, UYU)).toBe("$\u00A090.071.992.547.409,91");
    expect(formatDashboardAmount(MAX_SAFE, CLP)).toBe("CLP\u00A09.007.199.254.740.991");
    expect(formatDashboardAmount(MAX_SAFE, KWD)).toMatch(/9\.007\.199\.254\.740,991$/);
  });

  it("does not show as exact a sum that is no longer one: 'Más de' and 'Menos de' the largest amount", () => {
    expect(formatDashboardAmount(MAX_SAFE + 2, UYU)).toBe("Más de $\u00A090.071.992.547.409,91");
    expect(formatDashboardAmount(-(MAX_SAFE + 2), UYU)).toBe(
      "Menos de \u2212$\u00A090.071.992.547.409,91",
    );
    expect(formatDashboardAmount(1.8e19, CLP)).toBe("Más de CLP\u00A09.007.199.254.740.991");
    expect(formatDashboardAmount(Infinity, UYU)).toMatch(/^Más de /);
  });

  it("never throws, whatever it is given", () => {
    expect(formatDashboardAmount(Number.NaN, UYU)).toBe("—");
    expect(() => formatDashboardAmount(0.5, UYU)).not.toThrow();
  });
});

describe("formatPercent", () => {
  it("writes the number, a no-break space and the sign", () => {
    expect(formatPercent(58)).toBe("58\u00A0%");
    expect(formatPercent(0)).toBe("0\u00A0%");
    expect(formatPercent(100)).toBe("100\u00A0%");
    expect(formatPercent(BigInt(7))).toBe("7\u00A0%");
  });

  it("separates thousands, always", () => {
    expect(formatPercent(1250)).toBe("1.250\u00A0%");
  });
});

describe("formatCompactMoney", () => {
  it("writes the figures of an axis in words, with no currency sign: '25 mil'", () => {
    expect(formatCompactMoney(2500000, UYU)).toBe("25 mil");
    expect(formatCompactMoney(5000000, UYU)).toBe("50 mil");
    expect(formatCompactMoney(0, UYU)).toBe("0");
    expect(formatCompactMoney(150000, UYU)).toBe("1,5 mil");
    expect(formatCompactMoney(25000, UYU)).toBe("250");
  });

  it("goes on in millions and beyond", () => {
    expect(formatCompactMoney(100000000, UYU)).toBe("1 millón");
    expect(formatCompactMoney(150000000, UYU)).toBe("1,5 millones");
    expect(formatCompactMoney(BigInt("9007199254740991"), UYU)).toBe("90,1 billones");
  });

  it("uses the typographic minus for a negative one", () => {
    expect(formatCompactMoney(-2500000, UYU)).toBe("\u221225 mil");
  });

  it("follows the exponent of the currency (0, 2 and 3 decimals)", () => {
    expect(formatCompactMoney(25000, CLP)).toBe("25 mil");
    expect(formatCompactMoney(25000000, KWD)).toBe("25 mil");
  });

  it("reads the locale from the currency, as every amount does", () => {
    expect(formatCompactMoney(2500000, { code: "EUR", exponent: 2 })).toBe("25 mil");
    expect(formatCompactMoney(2500000, { code: "BRL", exponent: 2 })).toBe("25 mil");
  });

  it("takes a bigint and a string too, exactly", () => {
    expect(formatCompactMoney(BigInt(2500000), UYU)).toBe("25 mil");
    expect(formatCompactMoney("2500000", UYU)).toBe("25 mil");
  });
});

describe("niceTicks", () => {
  it("gives the ticks of the canvas for its biggest month: 0, 25 mil, 50 mil, 75 mil", () => {
    expect(niceTicks(BigInt(7250000))).toEqual([0, 2500000, 5000000, 7500000].map(BigInt));
  });

  it("ends at the maximum when it fits the step exactly, and above it when it does not", () => {
    expect(niceTicks(BigInt(7500000)).at(-1)).toBe(BigInt(7500000));
    expect(niceTicks(BigInt(7500001)).at(-1)).toBe(BigInt(15000000));
  });

  it("can have another number of ticks", () => {
    expect(niceTicks(BigInt(100), 5)).toEqual([0, 25, 50, 75, 100].map(BigInt));
    expect(niceTicks(BigInt(100), 2)).toEqual([0, 100].map(BigInt));
  });

  it("uses whole steps from the smallest maximums", () => {
    expect(niceTicks(BigInt(1))).toEqual([0, 1, 2, 3].map(BigInt));
    expect(niceTicks(BigInt(4))).toEqual([0, 2, 4, 6].map(BigInt));
    expect(niceTicks(BigInt(8))).toEqual([0, 5, 10, 15].map(BigInt));
  });

  it("gives 0, 1, 2, 3 when there is nothing to draw", () => {
    expect(niceTicks(BigInt(0))).toEqual([0, 1, 2, 3].map(BigInt));
    expect(niceTicks(BigInt(-5))).toEqual([0, 1, 2, 3].map(BigInt));
  });

  it("is exact for a maximum no float holds", () => {
    const max = BigInt("90071992547409910000");
    const ticks = niceTicks(max);
    expect(ticks).toHaveLength(4);
    expect(ticks[0]).toBe(BigInt(0));
    expect(ticks[3]! >= max).toBe(true);
    expect(ticks[3]).toBe(BigInt("150000000000000000000"));
  });

  it("always picks the smallest round step that reaches the maximum, for any maximum", () => {
    // The ladder of round steps, built apart from the function: 1, 2, 5 and 2.5 (from 25) times a power of ten.
    const ladder: bigint[] = [];
    for (let power = 0; power <= 22; power += 1) {
      const scale = BigInt(10) ** BigInt(power);
      for (const mantissa of [1, 2, 5, 25]) ladder.push(BigInt(mantissa) * scale);
    }
    ladder.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (let exponent = 0; exponent <= 15; exponent += 1) {
      for (const base of [1, 2, 3, 7, 9, 11, 24, 26, 49, 51, 99]) {
        const max = BigInt(base) * BigInt(10) ** BigInt(exponent);
        const ticks = niceTicks(max);
        const expected = ladder.find((step) => step * BigInt(3) >= max)!;
        expect(ticks).toEqual([0, 1, 2, 3].map((index) => BigInt(index) * expected));
        expect(ticks[3]! >= max).toBe(true);
      }
    }
  });

  it("refuses a count that is not at least 2", () => {
    expect(() => niceTicks(BigInt(100), 1)).toThrow(RangeError);
    expect(() => niceTicks(BigInt(100), 2.5)).toThrow(RangeError);
  });
});

describe("hasHistory and hasIncomeOrExpense", () => {
  it("is history when any month before the current one has something", () => {
    expect(hasHistory(CANVAS)).toBe(true);
    expect(hasHistory([point("2026-09", 0, 0, 500), point("2026-10", 0, 0, 500)])).toBe(true);
    expect(hasHistory([point("2026-09", 0, 10, 0), point("2026-10", 0, 0, 0)])).toBe(true);
    expect(hasHistory([point("2026-09", 10, 0, 0), point("2026-10", 0, 0, 0)])).toBe(true);
  });

  it("is not history when every month before the current one is empty, whatever the current has", () => {
    expect(hasHistory(ONE_MONTH)).toBe(false);
    expect(hasHistory([])).toBe(false);
    expect(hasHistory([point("2026-10", 100, 50, 50)])).toBe(false);
  });

  it("has income or expense when any month has a flow, the net alone is not one", () => {
    expect(hasIncomeOrExpense(CANVAS)).toBe(true);
    expect(hasIncomeOrExpense(ONE_MONTH)).toBe(true);
    expect(hasIncomeOrExpense([point("2026-09", 0, 0, 900), point("2026-10", 0, 0, 900)])).toBe(
      false,
    );
    expect(hasIncomeOrExpense([])).toBe(false);
  });
});

describe("describeNetChange", () => {
  it("writes the rise of the month with a plus, as the chip of the canvas ('+$ 4.330,00 este mes')", () => {
    expect(describeNetChange(9643000, CANVAS, UYU)).toEqual({
      direction: "up",
      text: "+$\u00A04.330,00 este mes",
    });
  });

  it("writes a fall with the typographic minus", () => {
    expect(describeNetChange(9000000, CANVAS, UYU)).toEqual({
      direction: "down",
      text: "\u2212$\u00A02.100,00 este mes",
    });
  });

  it("says there is no change when the net is the one of the month before", () => {
    expect(describeNetChange(9210000, CANVAS, UYU)).toEqual({
      direction: "flat",
      text: "Sin cambios este mes",
    });
  });

  it("takes the net of today from the dashboard, not from the last point of the series", () => {
    // A movement landed between the two requests: the card says 9.643.100 and the chip agrees.
    expect(describeNetChange(9643100, CANVAS, UYU)?.text).toBe("+$\u00A04.331,00 este mes");
  });

  it("is the difference with the close of the month before, with a net that went below zero", () => {
    expect(describeNetChange(-150000, CANVAS, UYU)?.text).toBe("\u2212$\u00A093.600,00 este mes");
  });

  it("follows the exponent of the currency", () => {
    expect(describeNetChange(1500, [point("a", 0, 0, 1000), point("b", 0, 0, 1)], CLP)?.text).toBe(
      "+CLP\u00A0500 este mes",
    );
    expect(describeNetChange(2500, [point("a", 0, 0, 1000), point("b", 0, 0, 1)], KWD)?.text).toBe(
      "+KWD\u00A01,500 este mes",
    );
  });

  it("has no chip without history: a net that rises from 0 is only the initial balance", () => {
    expect(describeNetChange(9643000, ONE_MONTH, UYU)).toBeNull();
    expect(describeNetChange(0, [], UYU)).toBeNull();
    expect(describeNetChange(500, [point("2026-10", 0, 0, 500)], UYU)).toBeNull();
  });

  it("has no chip when a figure is no longer exact", () => {
    expect(describeNetChange(MAX_SAFE + 2, CANVAS, UYU)).toBeNull();
    const beyond = [point("2026-09", 0, 0, MAX_SAFE + 2), point("2026-10", 0, 0, 1)];
    expect(describeNetChange(5, beyond, UYU)).toBeNull();
  });

  it("is exact with the largest amounts, where a float difference would not be", () => {
    const series = [point("2026-09", 1, 0, -MAX_SAFE), point("2026-10", 1, 0, 0)];
    expect(describeNetChange(MAX_SAFE, series, UYU)?.text).toBe(
      "+$\u00A0180.143.985.094.819,82 este mes",
    );
  });
});

describe("compareExpense", () => {
  it("compares the month's expenses with the month before, as the canvas does: '8 % menos que en setiembre'", () => {
    expect(compareExpense(CANVAS, "2026-10-21")).toEqual({
      direction: "less",
      percent: BigInt(8),
      text: "8\u00A0% menos que en setiembre",
    });
  });

  it("writes the month in es-UY, as the whole app does", () => {
    expect(compareExpense(CANVAS, "2026-10-21")?.text).toContain("setiembre");
    expect(compareExpense(CANVAS, "2026-10-21")?.text).not.toContain("septiembre");
  });

  it("compares from the 15th: before that a month that has just begun is set against a whole one", () => {
    expect(EXPENSE_COMPARISON_FROM_DAY).toBe(15);
    expect(compareExpense(CANVAS, "2026-10-01")).toBeNull();
    expect(compareExpense(CANVAS, "2026-10-03")).toBeNull();
    expect(compareExpense(CANVAS, "2026-10-14")).toBeNull();
    expect(compareExpense(CANVAS, "2026-10-15")).not.toBeNull();
    expect(compareExpense(CANVAS, "2026-10-31")).not.toBeNull();
  });

  it("says 'más' when the month cost more", () => {
    const series = [point("2026-09", 0, 100000, 0), point("2026-10", 0, 200000, 0)];
    expect(compareExpense(series, "2026-10-20")).toEqual({
      direction: "more",
      percent: BigInt(100),
      text: "100\u00A0% más que en setiembre",
    });
  });

  it("rounds to the nearest with the half up, as the backend's percentages do (12,5 is 13)", () => {
    const month = (spent: number) => [
      point("2026-09", 0, 100000, 0),
      point("2026-10", 0, spent, 0),
    ];
    expect(compareExpense(month(112500), "2026-10-20")?.text).toBe(
      "13\u00A0% más que en setiembre",
    );
    expect(compareExpense(month(112499), "2026-10-20")?.text).toBe(
      "12\u00A0% más que en setiembre",
    );
    expect(compareExpense(month(87500), "2026-10-20")?.text).toBe(
      "13\u00A0% menos que en setiembre",
    );
    expect(compareExpense(month(87501), "2026-10-20")?.text).toBe(
      "12\u00A0% menos que en setiembre",
    );
  });

  it("says 100 % menos for a month with no expenses after one that had them", () => {
    const series = [point("2026-09", 0, 100000, 0), point("2026-10", 0, 0, 0)];
    expect(compareExpense(series, "2026-10-20")).toMatchObject({
      direction: "less",
      text: "100\u00A0% menos que en setiembre",
    });
  });

  it("says 'Igual' when it is the same, and when the change rounds to 0 %", () => {
    const same = [point("2026-09", 0, 3980000, 0), point("2026-10", 0, 3980000, 0)];
    expect(compareExpense(same, "2026-10-20")).toEqual({
      direction: "same",
      percent: BigInt(0),
      text: "Igual que en setiembre",
    });
    const almost = [point("2026-09", 0, 3980000, 0), point("2026-10", 0, 3980100, 0)];
    expect(compareExpense(almost, "2026-10-20")?.direction).toBe("same");
  });

  it("does not compare with a month that had no expenses: there is nothing to compare with", () => {
    expect(compareExpense(ONE_MONTH, "2026-10-21")).toBeNull();
    const none = [point("2026-09", 0, 0, 0), point("2026-10", 0, 500, 0)];
    expect(compareExpense(none, "2026-10-21")).toBeNull();
  });

  it("names the month before across a year", () => {
    const series = [point("2025-12", 0, 100000, 0), point("2026-01", 0, 50000, 0)];
    expect(compareExpense(series, "2026-01-20")?.text).toBe("50\u00A0% menos que en diciembre");
  });

  it("needs today to be in the month of the last point, and a real day", () => {
    expect(compareExpense(CANVAS, "2026-11-20")).toBeNull();
    expect(compareExpense(CANVAS, "2026-09-20")).toBeNull();
    expect(compareExpense(CANVAS, "not a date")).toBeNull();
    expect(compareExpense(CANVAS, "2026-10-32")).toBeNull();
    expect(compareExpense(CANVAS, "")).toBeNull();
  });

  it("needs two months", () => {
    expect(compareExpense([], "2026-10-21")).toBeNull();
    expect(compareExpense([point("2026-10", 0, 500, 0)], "2026-10-21")).toBeNull();
  });

  it("has no note when a figure is no longer exact", () => {
    const current = [point("2026-09", 0, 100, 0), point("2026-10", 0, MAX_SAFE + 2, 0)];
    expect(compareExpense(current, "2026-10-21")).toBeNull();
    const previous = [point("2026-09", 0, MAX_SAFE + 2, 0), point("2026-10", 0, 100, 0)];
    expect(compareExpense(previous, "2026-10-21")).toBeNull();
  });

  describe("with the month's expenses of the dashboard (the figure the card shows)", () => {
    it("uses it as this month's expenses instead of the last point's, so the card and its note agree", () => {
      // The series says 36.770 (October's point) but the card shows 30.000: the note is about 30.000.
      expect(compareExpense(CANVAS, "2026-10-21", 3000000)).toEqual({
        direction: "less",
        percent: BigInt(25),
        text: "25\u00A0% menos que en setiembre",
      });
      // And the other way: a movement landed after the series was read.
      expect(compareExpense(CANVAS, "2026-10-21", 4377500)?.text).toBe(
        "10\u00A0% más que en setiembre",
      );
      expect(compareExpense(CANVAS, "2026-10-21", 3980000)?.text).toBe("Igual que en setiembre");
    });

    it("is the same note as without it when the two figures are the same", () => {
      const last = CANVAS.at(-1)!.expense_minor;
      expect(compareExpense(CANVAS, "2026-10-21", last)).toEqual(
        compareExpense(CANVAS, "2026-10-21"),
      );
    });

    it("behaves as before when it is not given, or given as undefined", () => {
      expect(compareExpense(CANVAS, "2026-10-21", undefined)).toEqual({
        direction: "less",
        percent: BigInt(8),
        text: "8\u00A0% menos que en setiembre",
      });
    });

    it("accepts a month with no expenses at all: 100 % menos, whatever the last point says", () => {
      expect(compareExpense(CANVAS, "2026-10-21", 0)?.text).toBe(
        "100\u00A0% menos que en setiembre",
      );
    });

    it("keeps the rest of the rules: the day, the month of today, the month before and exact figures", () => {
      expect(compareExpense(CANVAS, "2026-10-14", 3000000)).toBeNull();
      expect(compareExpense(CANVAS, "2026-11-20", 3000000)).toBeNull();
      expect(compareExpense(CANVAS, "not a date", 3000000)).toBeNull();
      expect(compareExpense(ONE_MONTH, "2026-10-21", 3000000)).toBeNull();
      expect(compareExpense([], "2026-10-21", 3000000)).toBeNull();
      // Not an exact integer, though the last point's is: the figure the card shows rules.
      expect(compareExpense(CANVAS, "2026-10-21", MAX_SAFE + 2)).toBeNull();
      expect(compareExpense(CANVAS, "2026-10-21", Number.NaN)).toBeNull();
      // The month before is not exact: no note, whatever this month is.
      const previous = [point("2026-09", 0, MAX_SAFE + 2, 0), point("2026-10", 0, 100, 0)];
      expect(compareExpense(previous, "2026-10-21", 100)).toBeNull();
    });

    it("is exact with the largest amounts", () => {
      const large = [point("2026-09", 0, MAX_SAFE, 0), point("2026-10", 0, 1, 0)];
      expect(compareExpense(large, "2026-10-21", MAX_SAFE - 1)?.direction).toBe("same");
    });
  });

  it("is exact with the largest amounts and with an enormous rise", () => {
    const large = [point("2026-09", 0, MAX_SAFE, 0), point("2026-10", 0, MAX_SAFE - 1, 0)];
    expect(compareExpense(large, "2026-10-21")?.direction).toBe("same");
    const enormous = [point("2026-09", 0, 1, 0), point("2026-10", 0, 1000000000000, 0)];
    const comparison = compareExpense(enormous, "2026-10-21");
    expect(comparison?.direction).toBe("more");
    expect(comparison?.percent).toBe(BigInt("99999999999900"));
  });
});

describe("describeMonthSavings", () => {
  it("is income minus expense, as the tooltip's 'Ahorro'", () => {
    expect(describeMonthSavings(CANVAS[5]!, UYU)).toBe("$\u00A031.230,00");
  });

  it("goes below zero with a minus when the month cost more than it brought", () => {
    expect(describeMonthSavings(point("2026-10", 100, 500, 0), UYU)).toBe("\u2212$\u00A04,00");
  });

  it("is a dash when a figure is not exact", () => {
    expect(describeMonthSavings(point("2026-10", MAX_SAFE + 2, 5, 0), UYU)).toBe("—");
  });
});

describe("formatMonthShort", () => {
  it("writes three letters in capitals with no period, in es-UY: 'Set' for setiembre", () => {
    const labels = Array.from({ length: 12 }, (_, index) =>
      formatMonthShort(`2026-${String(index + 1).padStart(2, "0")}`),
    );
    expect(labels).toEqual([
      "Ene",
      "Feb",
      "Mar",
      "Abr",
      "May",
      "Jun",
      "Jul",
      "Ago",
      "Set",
      "Oct",
      "Nov",
      "Dic",
    ]);
  });

  it("does not depend on the year, nor on the time zone of the machine", () => {
    expect(formatMonthShort("1900-01")).toBe("Ene");
    expect(formatMonthShort("2199-12")).toBe("Dic");
  });

  it("throws a RangeError for a text that is not a month", () => {
    expect(() => formatMonthShort("2026-13")).toThrow(RangeError);
    expect(() => formatMonthShort("octubre")).toThrow(RangeError);
  });
});

describe("describeNetChartLabel", () => {
  it("says the first and the last month of the series, as the canvas' example", () => {
    expect(describeNetChartLabel(CANVAS, UYU)).toBe(
      "Neto de los últimos 6 meses: de $\u00A071.200,00 en mayo a $\u00A096.430,00 en octubre",
    );
  });

  it("counts the months it has", () => {
    expect(describeNetChartLabel(CANVAS.slice(-3), UYU)).toBe(
      "Neto de los últimos 3 meses: de $\u00A088.300,00 en agosto a $\u00A096.430,00 en octubre",
    );
  });

  it("writes a negative net with the minus, and one that is not exact as 'Más de'", () => {
    const series = [point("2026-09", 0, 0, -500), point("2026-10", 0, 0, MAX_SAFE + 2)];
    expect(describeNetChartLabel(series, UYU)).toBe(
      "Neto de los últimos 2 meses: de \u2212$\u00A05,00 en setiembre a Más de $\u00A090.071.992.547.409,91 en octubre",
    );
  });

  it("holds one month and none", () => {
    expect(describeNetChartLabel([CANVAS[5]!], UYU)).toBe("Neto de octubre: $\u00A096.430,00");
    expect(describeNetChartLabel([], UYU)).toBe("Neto de los últimos meses: sin datos");
  });
});

describe("describeIncomeExpenseChartLabel", () => {
  it("says the months and the figures of the current one", () => {
    expect(describeIncomeExpenseChartLabel(CANVAS, UYU)).toBe(
      "Ingresos y gastos de los últimos 6 meses. En octubre (mes en curso): ingresos $\u00A068.000,00, gastos $\u00A036.770,00",
    );
  });

  it("holds one month and none", () => {
    expect(describeIncomeExpenseChartLabel([CANVAS[5]!], UYU)).toBe(
      "Ingresos y gastos del mes. En octubre (mes en curso): ingresos $\u00A068.000,00, gastos $\u00A036.770,00",
    );
    expect(describeIncomeExpenseChartLabel([], UYU)).toBe(
      "Ingresos y gastos de los últimos meses: sin datos",
    );
  });
});

describe("topBarWidths", () => {
  it("is relative to the largest category, as the canvas draws it: 100, 29, 23, 12 and 9", () => {
    const amounts = [2123000, 612000, 480000, 264000, 198000].map((amount_minor) => ({
      amount_minor,
    }));
    expect(topBarWidths(amounts)).toEqual([100, 29, 23, 12, 9]);
  });

  it("draws equal categories equally wide", () => {
    expect(topBarWidths([{ amount_minor: 500 }, { amount_minor: 500 }])).toEqual([100, 100]);
  });

  it("rounds to the nearest with the half up", () => {
    expect(topBarWidths([{ amount_minor: 8 }, { amount_minor: 1 }])).toEqual([100, 13]);
  });

  it("never draws a category that has something thinner than the minimum", () => {
    expect(MIN_BAR_PERCENT).toBe(2);
    expect(topBarWidths([{ amount_minor: 1000000000 }, { amount_minor: 1 }])).toEqual([100, 2]);
    expect(topBarWidths([{ amount_minor: 200 }, { amount_minor: 1 }])).toEqual([100, 2]);
  });

  it("draws nothing for an amount of 0 or less, and holds an empty list and a list of zeros", () => {
    expect(topBarWidths([])).toEqual([]);
    expect(topBarWidths([{ amount_minor: 0 }, { amount_minor: 0 }])).toEqual([0, 0]);
    expect(
      topBarWidths([{ amount_minor: 100 }, { amount_minor: 0 }, { amount_minor: -5 }]),
    ).toEqual([100, 0, 0]);
  });

  it("is exact with the largest amounts, where a float ratio would not be", () => {
    expect(topBarWidths([{ amount_minor: MAX_SAFE }, { amount_minor: 4503599627370496 }])).toEqual([
      100, 50,
    ]);
  });

  it("ignores a figure that is not an integer instead of failing", () => {
    expect(topBarWidths([{ amount_minor: 100 }, { amount_minor: Number.NaN }])).toEqual([100, 0]);
    expect(topBarWidths([{ amount_minor: 100 }, { amount_minor: 0.5 }])).toEqual([100, 0]);
  });
});

describe("the links of the top 5", () => {
  const CATEGORY = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0011";

  it("'Ver todo' goes to the expenses of the month in Movimientos", () => {
    expect(expensesHref("2026-10", "2026-10")).toBe("/movimientos?tipo=gastos");
  });

  it("a row goes to the expenses of the month in its category", () => {
    expect(topCategoryHref(CATEGORY, "2026-10", "2026-10")).toBe(
      `/movimientos?tipo=gastos&categoria_id=${CATEGORY}`,
    );
  });

  it("leave the month out when the dashboard's is the current one, as Movimientos opens in it", () => {
    expect(expensesHref("2026-10", "2026-10")).not.toContain("mes=");
    expect(topCategoryHref(CATEGORY, "2026-10", "2026-10")).not.toContain("mes=");
  });

  it("say the month when the dashboard's is not the current one: a dashboard kept from the month before, near midnight", () => {
    expect(expensesHref("2026-09", "2026-10")).toBe("/movimientos?mes=2026-09&tipo=gastos");
    expect(topCategoryHref(CATEGORY, "2026-09", "2026-10")).toBe(
      `/movimientos?mes=2026-09&tipo=gastos&categoria_id=${CATEGORY}`,
    );
    // Across a year too.
    expect(expensesHref("2025-12", "2026-01")).toBe("/movimientos?mes=2025-12&tipo=gastos");
  });

  it("are what Movimientos reads back: the type, the category and the dashboard's month", () => {
    const read = (href: string, currentMonth: string) =>
      parseMovementFilters(new URLSearchParams(href.split("?")[1]!), currentMonth);

    // Same month: it is the current one, so the list is the dashboard's month.
    expect(read(topCategoryHref(CATEGORY, "2026-10", "2026-10"), "2026-10")).toEqual({
      month: "2026-10",
      type: "expense",
      categoryId: CATEGORY,
    });
    expect(read(expensesHref("2026-10", "2026-10"), "2026-10")).toEqual({
      month: "2026-10",
      type: "expense",
    });
    // Another month: the list is still the dashboard's, not the current one.
    expect(read(topCategoryHref(CATEGORY, "2026-09", "2026-10"), "2026-10")).toEqual({
      month: "2026-09",
      type: "expense",
      categoryId: CATEGORY,
    });
    expect(read(expensesHref("2026-09", "2026-10"), "2026-10")).toEqual({
      month: "2026-09",
      type: "expense",
    });
  });
});

describe("the notes of Disponible and Deuda de tarjetas", () => {
  const bank = account({ id: "1", type: "bank" });
  const bank2 = account({ id: "2", type: "bank" });
  const cash = account({ id: "3", type: "cash" });
  const card = account({ id: "4", type: "credit_card" });
  const card2 = account({ id: "5", type: "credit_card" });

  it("count the banks and name the cash, as the canvas: '2 bancos y efectivo'", () => {
    expect(describeAvailableNote([bank, bank2, cash, card, card2])).toBe("2 bancos y efectivo");
    expect(describeAvailableNote([bank, cash])).toBe("1 banco y efectivo");
    expect(describeAvailableNote([bank, bank2])).toBe("2 bancos");
    expect(describeAvailableNote([bank])).toBe("1 banco");
  });

  it("name only the cash when there is no bank", () => {
    expect(describeAvailableNote([cash, card])).toBe("Efectivo");
    expect(describeAvailableNote([cash, account({ id: "6", type: "cash" })])).toBe(
      "2 cuentas de efectivo",
    );
  });

  it("say there is nothing available when there are only cards", () => {
    expect(describeAvailableNote([card])).toBe("Sin bancos ni efectivo");
    expect(describeAvailableNote([])).toBe("Sin bancos ni efectivo");
  });

  it("count the cards: 'En 2 tarjetas'", () => {
    expect(describeDebtNote([bank, card, card2])).toBe("En 2 tarjetas");
    expect(describeDebtNote([card])).toBe("En 1 tarjeta");
    expect(describeDebtNote([bank, cash])).toBe("Sin tarjetas");
    expect(describeDebtNote([])).toBe("Sin tarjetas");
  });

  it("name only the active accounts: an archived one has no balance, so the totals do not change without it", () => {
    const archived = "2026-09-01T10:00:00Z";
    const oldBank = account({ id: "7", type: "bank", archived_at: archived });
    const oldCard = account({ id: "8", type: "credit_card", archived_at: archived });
    expect(describeAvailableNote([bank, oldBank])).toBe("1 banco");
    expect(describeAvailableNote([oldBank])).toBe("Sin bancos ni efectivo");
    expect(describeDebtNote([card, oldCard])).toBe("En 1 tarjeta");
    expect(describeDebtNote([oldCard])).toBe("Sin tarjetas");
  });
});

import { describe, expect, it } from "vitest";
import type { MovementListItem, MovementPage } from "./data/transactions";
import {
  MAX_MONTH,
  MIN_MONTH,
  MOVEMENT_PARAMS,
  MOVEMENT_SEARCH_MAX_LENGTH,
  MOVEMENT_TYPE_PARAMS,
  activeFilterCount,
  applyMovementFilters,
  clearMovementFilters,
  describeDayTitle,
  describeFilterButton,
  describeMovementAccount,
  describeMovementCategory,
  describeMovementCount,
  describeMovementStatusNote,
  describeMovementSubline,
  describeMovementTitle,
  describeShown,
  flattenMovementPages,
  formatMovementDate,
  groupMovementsByDay,
  hasActiveFilters,
  isQuietMovement,
  movementAmountView,
  movementTypeFromParam,
  normalizeSearch,
  parseMovementFilters,
  serializeMovementFilters,
  shiftMonth,
  showsSummary,
  summaryFigures,
  type MovementFilters,
} from "./movements";

const UYU = { code: "UYU", exponent: 2 } as const;
const CURRENT = "2026-10";
const ID_A = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0002";
const ID_B = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0010";

// Money has a no-break space (U+00A0) between the symbol and the figure.
const NBSP = " ";
const MINUS = "−";

const ITAU = { id: "a1", name: "Itaú", type: "bank" } as const;
const VISA = { id: "a2", name: "Visa Itaú", type: "credit_card" } as const;
const FOOD = { id: "c1", name: "Comida", icon: "fork-knife", parent: null } as const;
const GROCERIES = {
  id: "c2",
  name: "Supermercado",
  icon: "shopping-cart",
  parent: { id: "c1", name: "Comida", icon: "fork-knife" },
} as const;

function item(overrides: Partial<MovementListItem> = {}): MovementListItem {
  return {
    id: "m1",
    type: "expense",
    status: "confirmed",
    date: "2026-10-20",
    description: "Tienda Inglesa",
    amount_minor: -234000,
    category: GROCERIES,
    account: VISA,
    from_account: null,
    to_account: null,
    balance_after_minor: null,
    ...overrides,
  };
}

const transfer = (overrides: Partial<MovementListItem> = {}) =>
  item({
    type: "transfer",
    description: "Pago de Visa Itaú",
    amount_minor: 1850000,
    category: null,
    account: null,
    from_account: ITAU,
    to_account: VISA,
    ...overrides,
  });

const adjustment = (overrides: Partial<MovementListItem> = {}) =>
  item({
    type: "adjustment",
    description: "Ajuste de saldo",
    amount_minor: -30000,
    category: null,
    account: ITAU,
    ...overrides,
  });

describe("movementTypeFromParam", () => {
  it("names the three types the chips ask for", () => {
    expect(movementTypeFromParam("gastos")).toBe("expense");
    expect(movementTypeFromParam("ingresos")).toBe("income");
    expect(movementTypeFromParam("transferencias")).toBe("transfer");
  });

  it("treats anything else as Todos: another word, the backend's value, an inherited key", () => {
    for (const param of [
      undefined,
      null,
      "",
      "todos",
      "expense",
      "ajustes",
      "toString",
      "GASTOS",
    ]) {
      expect(movementTypeFromParam(param)).toBeUndefined();
    }
  });
});

describe("parseMovementFilters", () => {
  it("is the current month and nothing else for a URL with no params", () => {
    expect(parseMovementFilters(new URLSearchParams(""), CURRENT)).toEqual({ month: CURRENT });
  });

  it("reads every filter from the params", () => {
    const params = new URLSearchParams(
      `mes=2026-09&tipo=gastos&q=uber&cuenta_id=${ID_A}&categoria_id=${ID_B}`,
    );
    expect(parseMovementFilters(params, CURRENT)).toEqual({
      month: "2026-09",
      type: "expense",
      q: "uber",
      accountId: ID_A,
      categoryId: ID_B,
    });
  });

  it("falls back to the current month for a month the backend would refuse", () => {
    for (const mes of ["", "2026", "2026-13", "1899-12", "2200-01", "octubre", "2026-10-01"]) {
      expect(parseMovementFilters(new URLSearchParams({ mes }), CURRENT).month).toBe(CURRENT);
    }
  });

  it("accepts the first and the last month of the backend's range", () => {
    expect(parseMovementFilters(new URLSearchParams({ mes: MIN_MONTH }), CURRENT).month).toBe(
      MIN_MONTH,
    );
    expect(parseMovementFilters(new URLSearchParams({ mes: MAX_MONTH }), CURRENT).month).toBe(
      MAX_MONTH,
    );
  });

  it("leaves out an id that is not a UUID (it would be a 422) and lowercases the one that is", () => {
    const params = new URLSearchParams({
      cuenta_id: "no-es-un-uuid",
      categoria_id: ID_B.toUpperCase(),
    });
    expect(parseMovementFilters(params, CURRENT)).toEqual({ month: CURRENT, categoryId: ID_B });
  });

  it("trims the search, leaves out an empty one and cuts a long one to 100 characters", () => {
    expect(parseMovementFilters(new URLSearchParams({ q: "  uber  " }), CURRENT).q).toBe("uber");
    expect(parseMovementFilters(new URLSearchParams({ q: "   " }), CURRENT)).not.toHaveProperty(
      "q",
    );
    expect(parseMovementFilters(new URLSearchParams({ q: "x".repeat(150) }), CURRENT).q).toBe(
      "x".repeat(MOVEMENT_SEARCH_MAX_LENGTH),
    );
  });

  it("takes the first of a repeated param, like URLSearchParams.get", () => {
    const params = new URLSearchParams("tipo=ingresos&tipo=gastos&mes=2026-08&mes=2026-09");
    expect(parseMovementFilters(params, CURRENT)).toEqual({ month: "2026-08", type: "income" });
  });

  it("reads the plain object a Next.js page gets as searchParams, arrays included", () => {
    expect(
      parseMovementFilters(
        { mes: "2026-09", tipo: ["transferencias", "gastos"], q: "café", otro: "x" },
        CURRENT,
      ),
    ).toEqual({ month: "2026-09", type: "transfer", q: "café" });
    expect(parseMovementFilters({}, CURRENT)).toEqual({ month: CURRENT });
    expect(parseMovementFilters({ tipo: undefined, q: [] }, CURRENT)).toEqual({ month: CURRENT });
  });

  it("does not take a param called get, or an inherited key, for the reader", () => {
    expect(parseMovementFilters({ get: "1", mes: "2026-08" }, CURRENT)).toEqual({
      month: "2026-08",
    });
    expect(parseMovementFilters(Object.create({ tipo: "gastos" }), CURRENT)).toEqual({
      month: CURRENT,
    });
  });

  it("reads the same filters from the server's object and from the client's URLSearchParams", () => {
    const query = `mes=2026-07&tipo=ingresos&q=sueldo&cuenta_id=${ID_A}`;
    const fromUrl = parseMovementFilters(new URLSearchParams(query), CURRENT);
    const fromRecord = parseMovementFilters(
      { mes: "2026-07", tipo: "ingresos", q: "sueldo", cuenta_id: ID_A },
      CURRENT,
    );
    expect(fromRecord).toEqual(fromUrl);
  });
});

describe("normalizeSearch", () => {
  it("counts code points like the backend: an emoji at the limit is not cut in half", () => {
    const text = "😀".repeat(120);
    const cut = normalizeSearch(text);
    expect([...(cut ?? "")]).toHaveLength(MOVEMENT_SEARCH_MAX_LENGTH);
    expect(cut).toBe("😀".repeat(MOVEMENT_SEARCH_MAX_LENGTH));
  });

  it("returns undefined for nothing, spaces or whitespace of any kind", () => {
    for (const text of [undefined, null, "", "   ", "\n\t", "  "]) {
      expect(normalizeSearch(text)).toBeUndefined();
    }
  });

  it("does not leave a trailing space where it cut", () => {
    const text = `${"a".repeat(99)} b`;
    expect(normalizeSearch(text)).toBe("a".repeat(99));
  });
});

describe("applyMovementFilters and serializeMovementFilters", () => {
  const FULL: MovementFilters = {
    month: "2026-09",
    type: "expense",
    q: "uber",
    accountId: ID_A,
    categoryId: ID_B,
  };

  it("writes nothing for the default view: the current month and no filters", () => {
    expect(serializeMovementFilters({ month: CURRENT }, CURRENT).toString()).toBe("");
  });

  it("writes only what is not the default, with the names of the screen", () => {
    expect(serializeMovementFilters({ month: "2026-09" }, CURRENT).toString()).toBe("mes=2026-09");
    expect(serializeMovementFilters(FULL, CURRENT).toString()).toBe(
      `mes=2026-09&tipo=gastos&q=uber&cuenta_id=${ID_A}&categoria_id=${ID_B}`,
    );
  });

  it("never uses the params of the side panels", () => {
    const names = new Set<string>(Object.values(MOVEMENT_PARAMS));
    for (const taken of ["cuenta", "categoria", "movimiento", "sel", "id", "padre"]) {
      expect(names.has(taken)).toBe(false);
    }
  });

  it("round-trips: what is written is what is read back", () => {
    const cases: MovementFilters[] = [
      { month: CURRENT },
      { month: "2026-09" },
      { month: CURRENT, type: "income" },
      { month: "1900-01", type: "transfer", q: "ñandú & café ☕" },
      FULL,
    ];
    for (const filters of cases) {
      const url = serializeMovementFilters(filters, CURRENT);
      expect(parseMovementFilters(url, CURRENT)).toEqual(filters);
    }
  });

  it("keeps the params of other things and takes the old filters away", () => {
    const search = `movimiento=nuevo&sel=${ID_A}&mes=2026-01&tipo=gastos&q=viejo&cuenta_id=${ID_A}&categoria_id=${ID_B}`;
    const next = applyMovementFilters(search, { month: CURRENT, type: "income" }, CURRENT);
    expect(next.get("movimiento")).toBe("nuevo");
    expect(next.get("sel")).toBe(ID_A);
    expect(next.get("tipo")).toBe("ingresos");
    for (const gone of ["mes", "q", "cuenta_id", "categoria_id"])
      expect(next.has(gone)).toBe(false);
  });

  it("does not change the URL it is given", () => {
    const search = new URLSearchParams("tipo=gastos");
    applyMovementFilters(search, { month: CURRENT }, CURRENT);
    expect(search.toString()).toBe("tipo=gastos");
  });

  it("leaves out a month that is not one and a search that is only spaces", () => {
    const filters = { month: "nope", q: "  " } as MovementFilters;
    expect(applyMovementFilters("", filters, CURRENT).toString()).toBe("");
  });

  it("encodes what needs it", () => {
    const url = serializeMovementFilters({ month: CURRENT, q: "a&b=c#d" }, CURRENT);
    expect(url.toString()).toBe("q=a%26b%3Dc%23d");
    expect(parseMovementFilters(url, CURRENT).q).toBe("a&b=c#d");
  });

  it("has a word for every type that the chips can ask for", () => {
    expect(Object.keys(MOVEMENT_TYPE_PARAMS).sort()).toEqual(["expense", "income", "transfer"]);
  });
});

describe("activeFilterCount, hasActiveFilters and clearMovementFilters", () => {
  it("counts the account and the category: the filters the screen does not show", () => {
    expect(activeFilterCount({ month: CURRENT })).toBe(0);
    expect(activeFilterCount({ month: CURRENT, type: "expense", q: "uber" })).toBe(0);
    expect(activeFilterCount({ month: CURRENT, accountId: ID_A })).toBe(1);
    expect(activeFilterCount({ month: CURRENT, accountId: ID_A, categoryId: ID_B })).toBe(2);
  });

  it("says whether anything narrows the list besides the month", () => {
    expect(hasActiveFilters({ month: "2026-01" })).toBe(false);
    expect(hasActiveFilters({ month: CURRENT, type: "income" })).toBe(true);
    expect(hasActiveFilters({ month: CURRENT, q: "x" })).toBe(true);
    expect(hasActiveFilters({ month: CURRENT, accountId: ID_A })).toBe(true);
    expect(hasActiveFilters({ month: CURRENT, categoryId: ID_B })).toBe(true);
  });

  it("clears everything but the month", () => {
    const cleared = clearMovementFilters({
      month: "2026-03",
      type: "expense",
      q: "x",
      accountId: ID_A,
      categoryId: ID_B,
    });
    expect(cleared).toEqual({ month: "2026-03" });
    expect(hasActiveFilters(cleared)).toBe(false);
  });
});

describe("describeFilterButton", () => {
  it("names the button with the number of filters on", () => {
    expect(describeFilterButton(0)).toBe("Filtrar");
    expect(describeFilterButton(1)).toBe("Filtrar, 1 filtro activo");
    expect(describeFilterButton(2)).toBe("Filtrar, 2 filtros activos");
  });
});

describe("shiftMonth", () => {
  it("moves one month either way", () => {
    expect(shiftMonth("2026-10", 1)).toBe("2026-11");
    expect(shiftMonth("2026-10", -1)).toBe("2026-09");
    expect(shiftMonth("2026-10", 0)).toBe("2026-10");
  });

  it("crosses the year in both directions", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
    expect(shiftMonth("2026-01", -13)).toBe("2024-12");
    expect(shiftMonth("2026-10", 27)).toBe("2029-01");
  });

  it("stops at the first and the last month the backend takes", () => {
    expect(shiftMonth(MIN_MONTH, -1)).toBeNull();
    expect(shiftMonth(MIN_MONTH, 1)).toBe("1900-02");
    expect(shiftMonth(MAX_MONTH, 1)).toBeNull();
    expect(shiftMonth(MAX_MONTH, -1)).toBe("2199-11");
    expect(shiftMonth("1900-03", -3)).toBeNull();
    expect(shiftMonth("2199-10", 2)).toBe(MAX_MONTH);
  });

  it("refuses a text that is not a month and a delta that is not whole", () => {
    expect(() => shiftMonth("2026-13", 1)).toThrow(RangeError);
    expect(() => shiftMonth("", 1)).toThrow(RangeError);
    expect(() => shiftMonth("2026-10", 0.5)).toThrow(RangeError);
    expect(() => shiftMonth("2026-10", Number.NaN)).toThrow(RangeError);
  });
});

describe("describeDayTitle", () => {
  const TODAY = "2026-10-22"; // a Thursday

  it("says Hoy and Ayer with the weekday in lowercase", () => {
    expect(describeDayTitle("2026-10-22", TODAY)).toBe("Hoy · jueves 22 de octubre");
    expect(describeDayTitle("2026-10-21", TODAY)).toBe("Ayer · miércoles 21 de octubre");
  });

  it("writes any other day with its weekday in capitals", () => {
    expect(describeDayTitle("2026-10-19", TODAY)).toBe("Lunes 19 de octubre");
    expect(describeDayTitle("2026-10-23", TODAY)).toBe("Viernes 23 de octubre");
  });

  it("adds the year only when it is not the current one", () => {
    expect(describeDayTitle("2025-12-31", TODAY)).toBe("Miércoles 31 de diciembre de 2025");
    expect(describeDayTitle("2027-01-02", TODAY)).toBe("Sábado 2 de enero de 2027");
  });

  it('knows yesterday across a month and a year (es-UY writes "setiembre")', () => {
    expect(describeDayTitle("2026-09-30", "2026-10-01")).toBe("Ayer · miércoles 30 de setiembre");
    expect(describeDayTitle("2025-12-31", "2026-01-01")).toBe("Ayer · miércoles 31 de diciembre");
  });

  it("shows a date that is not a real day as it came, and does not break with a bad 'today'", () => {
    expect(describeDayTitle("2026-02-30", TODAY)).toBe("2026-02-30");
    expect(describeDayTitle("ayer", TODAY)).toBe("ayer");
    expect(describeDayTitle("2026-10-19", "mañana")).toBe("Lunes 19 de octubre de 2026");
  });
});

describe("groupMovementsByDay", () => {
  const TODAY = "2026-10-22";

  it("groups a run of equal dates and keeps the order of the list", () => {
    const rows = [
      { id: 1, date: "2026-10-22" },
      { id: 2, date: "2026-10-22" },
      { id: 3, date: "2026-10-21" },
      { id: 4, date: "2026-10-19" },
      { id: 5, date: "2026-10-19" },
    ];
    const groups = groupMovementsByDay(rows, TODAY);
    expect(groups.map((group) => group.date)).toEqual(["2026-10-22", "2026-10-21", "2026-10-19"]);
    expect(groups.map((group) => group.title)).toEqual([
      "Hoy · jueves 22 de octubre",
      "Ayer · miércoles 21 de octubre",
      "Lunes 19 de octubre",
    ]);
    expect(groups.map((group) => group.items.map((row) => row.id))).toEqual([[1, 2], [3], [4, 5]]);
  });

  it("is one group for a day split between two pages", () => {
    const first = [{ id: 1, date: "2026-10-20" }];
    const second = [
      { id: 2, date: "2026-10-20" },
      { id: 3, date: "2026-10-19" },
    ];
    const groups = groupMovementsByDay([...first, ...second], TODAY);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.items.map((row) => row.id)).toEqual([1, 2]);
  });

  it("is empty for no movements and keeps the rows themselves", () => {
    expect(groupMovementsByDay([], TODAY)).toEqual([]);
    const row = item();
    expect(groupMovementsByDay([row], TODAY)[0]!.items[0]).toBe(row);
  });

  it("takes Hoy from the space's day, not from the machine's", () => {
    // The caller passes `todayInTimezone(space.timezone)`; whatever it is decides the title.
    expect(groupMovementsByDay([{ date: "2026-11-01" }], "2026-11-01")[0]!.title).toBe(
      "Hoy · domingo 1 de noviembre",
    );
    expect(groupMovementsByDay([{ date: "2026-11-01" }], "2026-10-31")[0]!.title).toBe(
      "Domingo 1 de noviembre",
    );
  });
});

describe("formatMovementDate", () => {
  it("writes the day and the short month", () => {
    expect(formatMovementDate("2026-10-20")).toBe("20 oct.");
    expect(formatMovementDate("2026-10-20", "2026-11-03")).toBe("20 oct.");
  });

  it("adds the year when it is not the current one", () => {
    expect(formatMovementDate("2025-10-20", "2026-11-03")).toBe("20 oct. 2025");
  });

  it("shows a date that is not a real day as it came", () => {
    expect(formatMovementDate("2026-02-30")).toBe("2026-02-30");
  });
});

describe("movementAmountView", () => {
  it("writes an expense with the minus, in the text color", () => {
    expect(movementAmountView(item({ amount_minor: -234000 }), UYU)).toEqual({
      text: `${MINUS}$${NBSP}2.340,00`,
      tone: "default",
    });
  });

  it("takes the sign from the type, so an expense is never shown as a gain", () => {
    expect(movementAmountView(item({ amount_minor: 234000 }), UYU).text).toBe(
      `${MINUS}$${NBSP}2.340,00`,
    );
  });

  it("writes an income with the plus, in the income color", () => {
    expect(movementAmountView(item({ type: "income", amount_minor: 15000 }), UYU)).toEqual({
      text: `+$${NBSP}150,00`,
      tone: "income",
    });
    expect(movementAmountView(item({ type: "income", amount_minor: -15000 }), UYU).text).toBe(
      `+$${NBSP}150,00`,
    );
  });

  it("writes a transfer with no sign and quiet", () => {
    expect(movementAmountView(transfer(), UYU)).toEqual({
      text: `$${NBSP}18.500,00`,
      tone: "muted",
    });
  });

  it("keeps the sign an adjustment carries, and is quiet", () => {
    expect(movementAmountView(adjustment({ amount_minor: -30000 }), UYU)).toEqual({
      text: `${MINUS}$${NBSP}300,00`,
      tone: "muted",
    });
    expect(movementAmountView(adjustment({ amount_minor: 30000 }), UYU)).toEqual({
      text: `+$${NBSP}300,00`,
      tone: "muted",
    });
  });

  it("uses the exponent of the currency, never ×100", () => {
    const CLP = { code: "CLP", exponent: 0 };
    const BHD = { code: "BHD", exponent: 3 };
    expect(movementAmountView(item({ amount_minor: -1500 }), CLP).text).toContain("1.500");
    expect(movementAmountView(item({ amount_minor: -1500 }), CLP).text).not.toContain(",");
    expect(movementAmountView(item({ amount_minor: -1500 }), BHD).text).toContain("1,500");
  });

  it("holds the largest amount the backend takes, to the last digit", () => {
    expect(
      movementAmountView(item({ type: "income", amount_minor: Number.MAX_SAFE_INTEGER }), UYU).text,
    ).toBe(`+$${NBSP}90.071.992.547.409,91`);
    expect(movementAmountView(item({ amount_minor: -Number.MAX_SAFE_INTEGER }), UYU).text).toBe(
      `${MINUS}$${NBSP}90.071.992.547.409,91`,
    );
  });

  it("writes a zero with no sign at all", () => {
    expect(movementAmountView(item({ amount_minor: 0 }), UYU).text).toBe(`$${NBSP}0,00`);
    expect(movementAmountView(adjustment({ amount_minor: 0 }), UYU).text).toBe(`$${NBSP}0,00`);
  });
});

describe("summaryFigures", () => {
  const SUMMARY = {
    count: 48,
    income_minor: 6815000,
    expense_minor: 3677000,
    remaining_minor: 3138000,
  };

  it("writes the three figures of the canvas: +income, −expense and +what is left", () => {
    expect(summaryFigures(SUMMARY, UYU)).toEqual({
      income: { label: "Ingresos", text: `+$${NBSP}68.150,00`, tone: "income" },
      expense: { label: "Gastos", text: `${MINUS}$${NBSP}36.770,00`, tone: "default" },
      remaining: { label: "Te quedan", text: `+$${NBSP}31.380,00`, tone: "default" },
    });
  });

  it("shows a negative 'Te quedan' with the minus and a period with no income in the text color", () => {
    const figures = summaryFigures(
      { count: 3, income_minor: 0, expense_minor: 500000, remaining_minor: -500000 },
      UYU,
    );
    expect(figures.income).toEqual({ label: "Ingresos", text: `$${NBSP}0,00`, tone: "default" });
    expect(figures.expense.text).toBe(`${MINUS}$${NBSP}5.000,00`);
    expect(figures.remaining.text).toBe(`${MINUS}$${NBSP}5.000,00`);
  });

  it("writes zero expenses and zero left without a sign", () => {
    const figures = summaryFigures(
      { count: 0, income_minor: 0, expense_minor: 0, remaining_minor: 0 },
      UYU,
    );
    expect(figures.expense.text).toBe(`$${NBSP}0,00`);
    expect(figures.remaining.text).toBe(`$${NBSP}0,00`);
  });

  it("holds the largest amounts without losing a digit", () => {
    const max = Number.MAX_SAFE_INTEGER;
    const figures = summaryFigures(
      { count: 1, income_minor: max, expense_minor: max, remaining_minor: 0 },
      UYU,
    );
    expect(figures.income.text).toBe(`+$${NBSP}90.071.992.547.409,91`);
    expect(figures.expense.text).toBe(`${MINUS}$${NBSP}90.071.992.547.409,91`);
  });
});

describe("showsSummary", () => {
  it("hides the summary only with Transferencias: they are neither income nor expense", () => {
    expect(showsSummary({})).toBe(true);
    expect(showsSummary({ type: "expense" })).toBe(true);
    expect(showsSummary({ type: "income" })).toBe(true);
    expect(showsSummary({ type: "transfer" })).toBe(false);
  });
});

describe("describeMovementTitle", () => {
  it("is the description", () => {
    expect(describeMovementTitle(item())).toBe("Tienda Inglesa");
    expect(describeMovementTitle(transfer())).toBe("Pago de Visa Itaú");
  });

  it("falls to the category of an expense or an income when there is no description", () => {
    expect(describeMovementTitle(item({ description: null }))).toBe("Supermercado");
    expect(describeMovementTitle(item({ description: "   " }))).toBe("Supermercado");
    expect(describeMovementTitle(item({ type: "income", description: "", category: FOOD }))).toBe(
      "Comida",
    );
  });

  it("falls to the two accounts of a transfer, and to the type when it has none to show", () => {
    expect(describeMovementTitle(transfer({ description: null }))).toBe("Itaú → Visa Itaú");
    expect(describeMovementTitle(transfer({ description: null, to_account: null }))).toBe(
      "Transferencia",
    );
    expect(describeMovementTitle(adjustment({ description: null }))).toBe("Ajuste");
    expect(describeMovementTitle(item({ description: null, category: null }))).toBe("Gasto");
  });

  it("never shows a raw backend value for a type it does not know", () => {
    const strange = item({ type: "refund" as MovementListItem["type"], description: null });
    expect(describeMovementTitle(strange)).toBe("Movimiento");
  });
});

describe("describeMovementSubline", () => {
  it("is the category's own name and the account", () => {
    expect(describeMovementSubline(item())).toBe("Supermercado · Visa Itaú");
    expect(describeMovementSubline(item({ category: FOOD, account: ITAU }))).toBe("Comida · Itaú");
  });

  it("tells a transfer by its two accounts and an adjustment by its account", () => {
    expect(describeMovementSubline(transfer())).toBe("Transferencia · Itaú → Visa Itaú");
    expect(describeMovementSubline(adjustment())).toBe("Ajuste · Itaú");
  });

  it("does not leave a dangling dot when a piece is missing", () => {
    expect(describeMovementSubline(item({ category: null }))).toBe("Visa Itaú");
    expect(describeMovementSubline(item({ account: null }))).toBe("Supermercado");
    expect(describeMovementSubline(item({ category: null, account: null }))).toBe("Gasto");
    expect(describeMovementSubline(transfer({ from_account: null }))).toBe("Transferencia");
    expect(describeMovementSubline(adjustment({ account: null }))).toBe("Ajuste");
  });

  it("ends with the state of a movement that is not confirmed", () => {
    expect(describeMovementSubline(item({ status: "pending" }))).toBe(
      "Supermercado · Visa Itaú · Pendiente",
    );
    expect(describeMovementSubline(item({ status: "skipped" }))).toBe(
      "Supermercado · Visa Itaú · Omitido",
    );
    expect(describeMovementSubline(item({ status: "confirmed" }))).toBe("Supermercado · Visa Itaú");
  });
});

describe("describeMovementStatusNote", () => {
  it("is null for a confirmed movement and the state for any other", () => {
    expect(describeMovementStatusNote({ status: "confirmed" })).toBeNull();
    expect(describeMovementStatusNote({ status: "pending" })).toBe("Pendiente");
    expect(describeMovementStatusNote({ status: "skipped" })).toBe("Omitido");
  });
});

describe("describeMovementCategory", () => {
  it("writes the principal and the subcategory, or just a principal", () => {
    expect(describeMovementCategory(item())).toEqual({
      label: "Comida › Supermercado",
      quiet: false,
    });
    expect(describeMovementCategory(item({ category: FOOD }))).toEqual({
      label: "Comida",
      quiet: false,
    });
  });

  it("writes Transferencia and Ajuste, quiet, since they have no category", () => {
    expect(describeMovementCategory(transfer())).toEqual({ label: "Transferencia", quiet: true });
    expect(describeMovementCategory(adjustment())).toEqual({ label: "Ajuste", quiet: true });
  });

  it("says 'Sin categoría' for an expense that has none", () => {
    expect(describeMovementCategory(item({ category: null }))).toEqual({
      label: "Sin categoría",
      quiet: true,
    });
  });
});

describe("describeMovementAccount", () => {
  it("is the account, or both in a transfer", () => {
    expect(describeMovementAccount(item())).toBe("Visa Itaú");
    expect(describeMovementAccount(transfer())).toBe("Itaú → Visa Itaú");
    expect(describeMovementAccount(adjustment())).toBe("Itaú");
  });

  it("does not show 'null' when an account is missing", () => {
    expect(describeMovementAccount(item({ account: null }))).toBe("Sin cuenta");
    expect(describeMovementAccount(transfer({ to_account: null }))).toBe("Sin cuenta");
  });
});

describe("isQuietMovement", () => {
  it("is true for a transfer and an adjustment only", () => {
    expect(isQuietMovement(item())).toBe(false);
    expect(isQuietMovement(item({ type: "income" }))).toBe(false);
    expect(isQuietMovement(transfer())).toBe(true);
    expect(isQuietMovement(adjustment())).toBe(true);
  });
});

describe("describeMovementCount and describeShown", () => {
  it("pluralizes", () => {
    expect(describeMovementCount(0)).toBe("0 movimientos");
    expect(describeMovementCount(1)).toBe("1 movimiento");
    expect(describeMovementCount(48)).toBe("48 movimientos");
  });

  it("groups thousands like the money", () => {
    expect(describeMovementCount(1234)).toBe("1.234 movimientos");
    expect(describeShown(1000, 12345)).toBe("Mostrando 1.000 de 12.345 movimientos");
  });

  it("writes 'Mostrando n de m movimientos'", () => {
    expect(describeShown(14, 48)).toBe("Mostrando 14 de 48 movimientos");
    expect(describeShown(1, 1)).toBe("Mostrando 1 de 1 movimiento");
    expect(describeShown(48, 48)).toBe("Mostrando 48 de 48 movimientos");
  });

  it("never shows more than the total: a summary that lags behind the list", () => {
    expect(describeShown(60, 48)).toBe("Mostrando 60 de 60 movimientos");
  });
});

describe("flattenMovementPages", () => {
  it("joins the pages in order", () => {
    const pages: MovementPage[] = [
      { items: [item({ id: "a" }), item({ id: "b" })], next_cursor: "x" },
      { items: [item({ id: "c" })], next_cursor: null },
    ];
    expect(flattenMovementPages({ pages }).map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  it("is empty before the first page and for an empty page", () => {
    expect(flattenMovementPages(undefined)).toEqual([]);
    expect(flattenMovementPages({ pages: [{ items: [], next_cursor: null }] })).toEqual([]);
  });
});

import type { AccountWithBalance } from "@/lib/core/data/accounts";
import type { DashboardRead, MonthlySeriesPoint } from "@/lib/core/data/dashboard";
import type { MovementListItem } from "@/lib/core/data/transactions";
import type { Currency } from "@/lib/core/money";

// The data the Inicio's dashboard is tried with (FE-35, KAN-101): the numbers of the Kanza canvas
// (K-V2-Escritorio, vista `inicio`) and the cases a person or a break-ui pass can produce. For the
// tests of the dashboard and its catalog section, through `scriptedDashboardApi`. Not imported by the
// app, and on purpose it does not import the logic it is meant to check (`lib/core/dashboard.ts`):
// a fake that borrowed the rule would repeat its mistakes.

/** Which case: see `DASHBOARD_SCENARIOS`. */
export type ScenarioId =
  | "canvas"
  | "worst-case"
  | "one-month"
  | "no-expenses"
  | "no-movements"
  | "negative-net"
  | "at-the-limit"
  | "beyond-the-limit"
  | "exponent-0"
  | "exponent-3"
  | "many-accounts";

export type DashboardScenario = {
  id: ScenarioId;
  label: string;
  currency: Currency;
  /** The space's day (`YYYY-MM-DD`): the canvas draws "Miércoles 21 de octubre". */
  today: string;
  /** What `GET /dashboard` answers. */
  dashboard: DashboardRead;
  /** What `GET /dashboard/series` answers: the six months that end in the current one, oldest first. */
  series: MonthlySeriesPoint[];
  /** The active accounts, as `GET /accounts` lists them. */
  accounts: AccountWithBalance[];
  /** The movements of the space, newest first: the first six are "Últimos movimientos". */
  movements: MovementListItem[];
};

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** A UUID that is always the same for the same kind and number (the links to Movimientos only take UUIDs). */
function uuid(kind: "category" | "account" | "movement", n: number): string {
  const base = { category: 0x100, account: 0x200, movement: 0x300 }[kind] + n;
  return `00000000-0000-4000-8000-${base.toString(16).padStart(12, "0")}`;
}

/** At most `length` code points: an emoji counts as one, as the backend's `maxLength` does. */
const codePoints = (text: string, length: number) => Array.from(text).slice(0, length).join("");

/** Exactly 80 characters, the longest name of an account or a category. */
const NAME_80 = codePoints(
  "Una categoría con un nombre larguísimo que llena todo el espacio que le dejen disponible",
  80,
);
const NO_SPACES_80 = codePoints("Supercalifragilísticoespialidoso".repeat(3), 80);
const EMOJI_80 = codePoints("🍕🍔🍟🌮🥗🍣🍜🍰☕🍺".repeat(8), 80);
const ARABIC_80 = codePoints(
  "مطعم الأسرة والأصدقاء للمأكولات الشهية والمشروبات الباردة والساخنة في كل الأوقات",
  80,
);

/** Exactly 200 characters, the longest description of a movement. */
const DESCRIPTION_200 = codePoints(
  "Una descripción que llega al máximo de doscientos caracteres, con palabras que se parten entre líneas distintas y que nadie escribiría de verdad en una libreta de gastos de todos los días. ".repeat(
    2,
  ),
  200,
);
const NO_SPACES_200 = codePoints("DescripciónSinEspacios".repeat(12), 200);
const EMOJI_200 = codePoints("🧾💸🛒🚌🍽️".repeat(60), 200);
const ARABIC_200 = codePoints(
  "وصف طويل جدا للحركة يصل إلى الحد الأقصى من الأحرف ويستمر ".repeat(8),
  200,
);

// --- The pieces ------------------------------------------------------------------------------------

type CategoryKey = "food" | "transport" | "home" | "health" | "leisure";
type AccountRef = NonNullable<MovementListItem["account"]>;
type CategoryRef = NonNullable<MovementListItem["category"]>;
type Icon = CategoryRef["icon"];

const CATEGORIES: Record<CategoryKey, { n: number; name: string; icon: Icon }> = {
  food: { n: 1, name: "Comida", icon: "fork-knife" },
  transport: { n: 2, name: "Transporte", icon: "car" },
  home: { n: 3, name: "Hogar", icon: "house" },
  health: { n: 4, name: "Salud", icon: "heartbeat" },
  leisure: { n: 5, name: "Ocio", icon: "game-controller" },
};

function account(
  n: number,
  name: string,
  type: AccountWithBalance["type"],
  balance: number,
  days?: { closing: number; due: number },
): AccountWithBalance {
  return {
    id: uuid("account", n),
    name,
    type,
    balance_minor: balance,
    closing_day: days?.closing ?? null,
    due_day: days?.due ?? null,
    archived_at: null,
  };
}

const refOf = ({ id, name, type }: AccountWithBalance): AccountRef => ({ id, name, type });

/** A subcategory of a principal, as the list of movements tells it. */
function subcategory(key: CategoryKey, n: number, name: string, icon: Icon): CategoryRef {
  const parent = CATEGORIES[key];
  return {
    id: uuid("category", 20 + n),
    name,
    icon,
    parent: { id: uuid("category", parent.n), name: parent.name, icon: parent.icon },
  };
}

type Flow = {
  n: number;
  type: MovementListItem["type"];
  date: string;
  description: string | null;
  amount: number;
  account?: AccountWithBalance;
  from?: AccountWithBalance;
  to?: AccountWithBalance;
  category?: CategoryRef | null;
  status?: MovementListItem["status"];
};

function movement(flow: Flow): MovementListItem {
  return {
    id: uuid("movement", flow.n),
    type: flow.type,
    status: flow.status ?? "confirmed",
    date: flow.date,
    description: flow.description,
    amount_minor: flow.amount,
    category: flow.category ?? null,
    account: flow.account ? refOf(flow.account) : null,
    from_account: flow.from ? refOf(flow.from) : null,
    to_account: flow.to ? refOf(flow.to) : null,
    balance_after_minor: null,
  };
}

const point = (
  month: string,
  income: number,
  expense: number,
  net: number,
): MonthlySeriesPoint => ({
  month,
  income_minor: income,
  expense_minor: expense,
  net_minor: net,
});

const MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"] as const;

/**
 * The backend's whole percent: `(200·part + total) // (2·total)`, rounded to the nearest with the half
 * up. Written here, apart from the app, with BigInt; 0 if there is no total.
 */
function percentOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return Number((BigInt(200) * BigInt(part) + BigInt(total)) / (BigInt(2) * BigInt(total)));
}

function topOf(
  rows: readonly { key: CategoryKey; name?: string; amount: number }[],
  total: number,
): DashboardRead["top_expense_categories"] {
  return rows.map(({ key, name, amount }) => ({
    category_id: uuid("category", CATEGORIES[key].n),
    name: name ?? CATEGORIES[key].name,
    icon: CATEGORIES[key].icon,
    amount_minor: amount,
    percentage: percentOf(amount, total),
  }));
}

const UYU: Currency = { code: "UYU", exponent: 2 };
const TODAY = "2026-10-21";

// --- The canvas ------------------------------------------------------------------------------------

const ITAU = account(1, "Itaú", "bank", 8_425_000);
const BROU = account(2, "BROU Caja de ahorro", "bank", 3_915_000);
const EFECTIVO = account(3, "Efectivo", "cash", 550_000);
const VISA = account(4, "Visa Itaú", "credit_card", -2_412_000, { closing: 5, due: 12 });
const OCA = account(5, "Mastercard OCA", "credit_card", -835_000, { closing: 20, due: 3 });

/** Disponible 128.900, Deuda 32.470, Neto 96.430: the three that add up in the canvas. */
const CANVAS_ACCOUNTS = [ITAU, BROU, EFECTIVO, VISA, OCA];

const CANVAS_MOVEMENTS: MovementListItem[] = [
  movement({
    n: 1,
    type: "expense",
    date: "2026-10-20",
    description: "Tienda Inglesa",
    amount: -234_000,
    account: VISA,
    category: subcategory("food", 1, "Supermercado", "shopping-cart"),
  }),
  movement({
    n: 2,
    type: "expense",
    date: "2026-10-19",
    description: "Uber",
    amount: -38_000,
    account: ITAU,
    category: subcategory("transport", 1, "Taxi y apps", "taxi"),
  }),
  movement({
    n: 3,
    type: "expense",
    date: "2026-10-18",
    description: "Farmacia",
    amount: -64_000,
    account: EFECTIVO,
    category: subcategory("health", 1, "Medicamentos", "pill"),
  }),
  movement({
    n: 4,
    type: "transfer",
    date: "2026-10-17",
    description: "Pago de Visa Itaú",
    amount: 1_850_000,
    from: ITAU,
    to: VISA,
  }),
  movement({
    n: 5,
    type: "expense",
    date: "2026-10-16",
    description: "UTE",
    amount: -215_000,
    account: ITAU,
    category: subcategory("home", 1, "Servicios", "lightbulb"),
  }),
  movement({
    n: 6,
    type: "expense",
    date: "2026-10-15",
    description: "Cine",
    amount: -90_000,
    account: OCA,
    category: subcategory("leisure", 1, "Salidas", "martini"),
  }),
  movement({
    n: 7,
    type: "expense",
    date: "2026-10-14",
    description: "Netflix",
    amount: -39_000,
    account: VISA,
    category: subcategory("leisure", 2, "Suscripciones", "monitor-play"),
  }),
  movement({
    n: 8,
    type: "income",
    date: "2026-10-01",
    description: "Sueldo",
    amount: 6_800_000,
    account: ITAU,
    category: {
      id: uuid("category", 40),
      name: "Sueldo",
      icon: "money",
      parent: { id: uuid("category", 41), name: "Trabajo", icon: "briefcase" },
    },
  }),
];

// May to October: the net at the close of each month (7.120 to 96.430, in the canvas' hundreds) and
// what came in and went out in it. October is the current month: its net is the one of today.
const CANVAS_SERIES: MonthlySeriesPoint[] = [
  point(MONTHS[0], 6_500_000, 4_120_000, 7_120_000),
  point(MONTHS[1], 6_500_000, 3_890_000, 7_690_000),
  point(MONTHS[2], 7_250_000, 4_430_000, 8_140_000),
  point(MONTHS[3], 6_500_000, 3_560_000, 8_830_000),
  point(MONTHS[4], 6_800_000, 3_980_000, 9_210_000),
  point(MONTHS[5], 6_800_000, 3_677_000, 9_643_000),
];

const CANVAS: DashboardScenario = {
  id: "canvas",
  label: "Los del lienzo",
  currency: UYU,
  today: TODAY,
  dashboard: {
    month: "2026-10",
    available_minor: 12_890_000,
    card_debt_minor: 3_247_000,
    net_minor: 9_643_000,
    month_expense_minor: 3_677_000,
    top_expense_categories: topOf(
      [
        { key: "food", amount: 2_123_000 },
        { key: "transport", amount: 612_000 },
        { key: "home", amount: 480_000 },
        { key: "health", amount: 264_000 },
        { key: "leisure", amount: 198_000 },
      ],
      3_677_000,
    ),
  },
  series: CANVAS_SERIES,
  accounts: CANVAS_ACCOUNTS,
  movements: CANVAS_MOVEMENTS,
};

// --- The cases -------------------------------------------------------------------------------------

/** Multiplies or divides every amount of a scenario: the canvas in another currency (the exponent changes). */
function rescale(
  base: DashboardScenario,
  changes: Pick<DashboardScenario, "id" | "label" | "currency">,
  by: (amount: number) => number,
): DashboardScenario {
  return {
    ...base,
    ...changes,
    dashboard: {
      ...base.dashboard,
      available_minor: by(base.dashboard.available_minor),
      card_debt_minor: by(base.dashboard.card_debt_minor),
      net_minor: by(base.dashboard.net_minor),
      month_expense_minor: by(base.dashboard.month_expense_minor),
      top_expense_categories: base.dashboard.top_expense_categories.map((row) => ({
        ...row,
        amount_minor: by(row.amount_minor),
      })),
    },
    series: base.series.map((p) => ({
      ...p,
      income_minor: by(p.income_minor),
      expense_minor: by(p.expense_minor),
      net_minor: by(p.net_minor),
    })),
    accounts: base.accounts.map((a) => ({ ...a, balance_minor: by(a.balance_minor) })),
    movements: base.movements.map((m) => ({ ...m, amount_minor: by(m.amount_minor) })),
  };
}

// Month, income, expense and net for a first month of use: the five before it are all 0.
const ONE_MONTH_SERIES = [
  ...MONTHS.slice(0, 5).map((month) => point(month, 0, 0, 0)),
  point(MONTHS[5], 6_800_000, 3_677_000, 9_643_000),
];

const NO_EXPENSES_SERIES = CANVAS_SERIES.map((p) =>
  p.month === MONTHS[5] ? point(p.month, 6_800_000, 0, p.net_minor) : p,
);

const BANK_NEGATIVE = account(1, "Itaú", "bank", 100_000);
const CARD_NEGATIVE = account(2, "Visa Itaú", "credit_card", -450_000, { closing: 5, due: 12 });

const WORST_BANK = account(1, NAME_80, "bank", 4_000_000_000_000_000);
const WORST_CASH = account(2, NO_SPACES_80, "cash", 5_007_199_254_740_991);
const WORST_CARD = account(3, ARABIC_80, "credit_card", -2_000_000_000_000_000, {
  closing: 31,
  due: 31,
});
const WORST_PAID_CARD = account(4, EMOJI_80, "credit_card", 0, { closing: 1, due: 1 });
const WORST_ACCOUNTS = [WORST_BANK, WORST_CASH, WORST_CARD, WORST_PAID_CARD];

const WORST_TOP_AMOUNTS = [MAX_SAFE - 40_000_000, 20_000_000, 10_000_000, 5_000_000, 5_000_000];

const WORST_CASE: DashboardScenario = {
  id: "worst-case",
  label: "Peor caso",
  currency: UYU,
  today: TODAY,
  dashboard: {
    month: "2026-10",
    available_minor: MAX_SAFE,
    card_debt_minor: 2_000_000_000_000_000,
    net_minor: MAX_SAFE - 2_000_000_000_000_000,
    month_expense_minor: MAX_SAFE,
    top_expense_categories: topOf(
      [
        { key: "food", name: NAME_80, amount: WORST_TOP_AMOUNTS[0]! },
        { key: "transport", name: NO_SPACES_80, amount: WORST_TOP_AMOUNTS[1]! },
        { key: "home", name: EMOJI_80, amount: WORST_TOP_AMOUNTS[2]! },
        { key: "health", name: ARABIC_80, amount: WORST_TOP_AMOUNTS[3]! },
        { key: "leisure", name: "Ocio", amount: WORST_TOP_AMOUNTS[4]! },
      ],
      MAX_SAFE,
    ),
  },
  series: [
    point(MONTHS[0], MAX_SAFE, 9_000_000_000_000_000, -MAX_SAFE),
    point(MONTHS[1], 1, MAX_SAFE, 7_000_000_000_000_000),
    point(MONTHS[2], 0, 0, 7_000_000_000_000_000),
    point(MONTHS[3], 123_456_789, 987_654_321, 6_999_999_000_000_000),
    point(MONTHS[4], MAX_SAFE, 1, MAX_SAFE),
    point(MONTHS[5], MAX_SAFE, MAX_SAFE, MAX_SAFE - 2_000_000_000_000_000),
  ],
  accounts: WORST_ACCOUNTS,
  movements: [
    movement({
      n: 1,
      type: "expense",
      date: "2026-10-20",
      description: DESCRIPTION_200,
      amount: -MAX_SAFE,
      account: WORST_BANK,
      category: {
        id: uuid("category", 60),
        name: NAME_80,
        icon: "tag",
        parent: { id: uuid("category", 61), name: NO_SPACES_80, icon: "tag" },
      },
    }),
    movement({
      n: 2,
      type: "income",
      date: "2026-10-19",
      description: NO_SPACES_200,
      amount: MAX_SAFE,
      account: WORST_CASH,
      category: { id: uuid("category", 62), name: EMOJI_80, icon: "money", parent: null },
    }),
    movement({
      n: 3,
      type: "transfer",
      date: "2026-10-18",
      description: EMOJI_200,
      amount: MAX_SAFE,
      from: WORST_BANK,
      to: WORST_CARD,
    }),
    movement({
      n: 4,
      type: "expense",
      date: "2026-10-17",
      description: ARABIC_200,
      amount: -123_456,
      account: WORST_CARD,
      category: { id: uuid("category", 63), name: ARABIC_80, icon: "tag", parent: null },
    }),
    movement({
      n: 5,
      type: "adjustment",
      date: "2026-10-16",
      description: null,
      amount: -MAX_SAFE,
      account: WORST_CASH,
    }),
    movement({
      n: 6,
      type: "expense",
      date: "2026-10-15",
      description: "Pendiente de confirmar",
      amount: -1,
      account: WORST_BANK,
      status: "pending",
      category: subcategory("food", 1, "Supermercado", "shopping-cart"),
    }),
  ],
};

/** Two accounts that each hold the most one can: the sums the dashboard shows are no longer exact. */
const BEYOND_BANK = account(1, "Itaú", "bank", MAX_SAFE);
const BEYOND_ACCOUNTS = [BEYOND_BANK, account(2, "BROU Caja de ahorro", "bank", MAX_SAFE)];

const BEYOND_THE_LIMIT: DashboardScenario = {
  id: "beyond-the-limit",
  label: "Sumas fuera del rango seguro",
  currency: UYU,
  today: TODAY,
  dashboard: {
    month: "2026-10",
    available_minor: MAX_SAFE * 2,
    card_debt_minor: 0,
    net_minor: MAX_SAFE * 2,
    month_expense_minor: MAX_SAFE * 2,
    top_expense_categories: topOf(
      [
        { key: "food", amount: MAX_SAFE },
        { key: "transport", amount: MAX_SAFE },
      ],
      MAX_SAFE * 2,
    ),
  },
  series: [
    point(MONTHS[0], 0, 0, 0),
    point(MONTHS[1], 0, 0, 0),
    point(MONTHS[2], MAX_SAFE, 0, MAX_SAFE),
    point(MONTHS[3], MAX_SAFE, MAX_SAFE, MAX_SAFE),
    point(MONTHS[4], MAX_SAFE * 2, MAX_SAFE, MAX_SAFE * 2),
    point(MONTHS[5], MAX_SAFE * 2, MAX_SAFE * 2, MAX_SAFE * 2),
  ],
  accounts: BEYOND_ACCOUNTS,
  movements: [
    movement({
      n: 1,
      type: "income",
      date: "2026-10-20",
      description: "Herencia",
      amount: MAX_SAFE,
      account: BEYOND_BANK,
      category: subcategory("food", 1, "Supermercado", "shopping-cart"),
    }),
  ],
};

const AT_THE_LIMIT_BANK = account(1, "Itaú", "bank", MAX_SAFE);

/** Every single figure at the most the backend takes, and still exact: the largest that is shown in full. */
const AT_THE_LIMIT: DashboardScenario = {
  id: "at-the-limit",
  label: "Montos al tope",
  currency: UYU,
  today: TODAY,
  dashboard: {
    month: "2026-10",
    available_minor: MAX_SAFE,
    card_debt_minor: 0,
    net_minor: MAX_SAFE,
    month_expense_minor: MAX_SAFE,
    top_expense_categories: topOf([{ key: "food", amount: MAX_SAFE }], MAX_SAFE),
  },
  series: [
    point(MONTHS[0], 0, 0, 0),
    point(MONTHS[1], 0, 0, 0),
    point(MONTHS[2], 0, 0, 0),
    point(MONTHS[3], 0, 0, 0),
    point(MONTHS[4], MAX_SAFE, 1, MAX_SAFE - 1),
    point(MONTHS[5], MAX_SAFE, MAX_SAFE, MAX_SAFE),
  ],
  accounts: [AT_THE_LIMIT_BANK],
  movements: [
    movement({
      n: 1,
      type: "expense",
      date: "2026-10-20",
      description: "El gasto más grande que se puede registrar",
      amount: -MAX_SAFE,
      account: AT_THE_LIMIT_BANK,
      category: subcategory("food", 1, "Supermercado", "shopping-cart"),
    }),
  ],
};

/** 40 active accounts of the three types: the card of "Cuentas" must hold them. */
const MANY_ACCOUNTS: AccountWithBalance[] = Array.from({ length: 40 }, (_, index) => {
  const type: AccountWithBalance["type"] =
    index % 5 === 4 ? "credit_card" : index % 5 === 3 ? "cash" : "bank";
  const name = `${type === "credit_card" ? "Tarjeta" : type === "cash" ? "Efectivo" : "Banco"} número ${index + 1}`;
  const balance = type === "credit_card" ? -(index + 1) * 10_000 : (index + 1) * 100_000;
  return account(
    index + 1,
    name,
    type,
    balance,
    type === "credit_card" ? { closing: (index % 28) + 1, due: ((index + 7) % 28) + 1 } : undefined,
  );
});

function totalsOf(accounts: readonly AccountWithBalance[]) {
  let available = 0;
  let debt = 0;
  for (const a of accounts) {
    if (a.type === "credit_card") debt += -a.balance_minor;
    else available += a.balance_minor;
  }
  return { available, debt, net: available - debt };
}

const MANY_TOTALS = totalsOf(MANY_ACCOUNTS);

export const DASHBOARD_SCENARIOS: Record<ScenarioId, DashboardScenario> = {
  canvas: CANVAS,
  "worst-case": WORST_CASE,
  "one-month": {
    ...CANVAS,
    id: "one-month",
    label: "Un solo mes de historia",
    series: ONE_MONTH_SERIES,
    movements: CANVAS_MOVEMENTS.slice(0, 3),
  },
  "no-expenses": {
    ...CANVAS,
    id: "no-expenses",
    label: "Sin gastos este mes",
    dashboard: {
      ...CANVAS.dashboard,
      month_expense_minor: 0,
      top_expense_categories: [],
    },
    series: NO_EXPENSES_SERIES,
    movements: CANVAS_MOVEMENTS.filter((m) => m.type === "income" || m.type === "transfer"),
  },
  "no-movements": {
    ...CANVAS,
    id: "no-movements",
    label: "Cuentas sin movimientos",
    dashboard: {
      month: "2026-10",
      available_minor: 0,
      card_debt_minor: 0,
      net_minor: 0,
      month_expense_minor: 0,
      top_expense_categories: [],
    },
    series: MONTHS.map((month) => point(month, 0, 0, 0)),
    accounts: CANVAS_ACCOUNTS.map((a) => ({ ...a, balance_minor: 0 })),
    movements: [],
  },
  "negative-net": {
    ...CANVAS,
    id: "negative-net",
    label: "Neto negativo",
    dashboard: {
      month: "2026-10",
      available_minor: 100_000,
      card_debt_minor: 450_000,
      net_minor: -350_000,
      month_expense_minor: 3_677_000,
      top_expense_categories: CANVAS.dashboard.top_expense_categories,
    },
    series: [
      point(MONTHS[0], 6_500_000, 4_120_000, 1_200_000),
      point(MONTHS[1], 6_500_000, 5_890_000, 400_000),
      point(MONTHS[2], 3_250_000, 4_430_000, -380_000),
      point(MONTHS[3], 2_500_000, 3_560_000, -1_440_000),
      point(MONTHS[4], 2_800_000, 3_980_000, -2_620_000),
      point(MONTHS[5], 3_800_000, 3_677_000, -350_000),
    ],
    accounts: [BANK_NEGATIVE, CARD_NEGATIVE],
  },
  "at-the-limit": AT_THE_LIMIT,
  "beyond-the-limit": BEYOND_THE_LIMIT,
  "exponent-0": rescale(
    CANVAS,
    {
      id: "exponent-0",
      label: "Peso chileno (sin decimales)",
      currency: { code: "CLP", exponent: 0 },
    },
    (amount) => amount / 100,
  ),
  "exponent-3": rescale(
    CANVAS,
    {
      id: "exponent-3",
      label: "Dinar bareiní (3 decimales)",
      currency: { code: "BHD", exponent: 3 },
    },
    (amount) => amount * 10,
  ),
  "many-accounts": {
    ...CANVAS,
    id: "many-accounts",
    label: "Muchas cuentas (40)",
    dashboard: {
      ...CANVAS.dashboard,
      available_minor: MANY_TOTALS.available,
      card_debt_minor: MANY_TOTALS.debt,
      net_minor: MANY_TOTALS.net,
    },
    // The net of the last month is today's; the months before it were a million lower, one after another.
    series: CANVAS_SERIES.map((p, index) => ({
      ...p,
      net_minor: MANY_TOTALS.net - (CANVAS_SERIES.length - 1 - index) * 1_000_000,
    })),
    accounts: MANY_ACCOUNTS,
  },
};

/** The scenarios in the order a selector lists them. */
export const SCENARIO_LIST: readonly DashboardScenario[] = Object.values(DASHBOARD_SCENARIOS);

import type { AccountWithBalance } from "./data/accounts";
import type { MonthlySeriesPoint, TopExpenseCategory } from "./data/dashboard";
import { formatMonthName, isLocalDate, isMonth } from "./dates";
import { localeForCurrency, DEFAULT_LOCALE } from "./locale";
import {
  formatMoney,
  minorToDecimalString,
  type Currency,
  type FormatMoneyOptions,
  type MinorAmount,
} from "./money";
import { serializeMovementFilters, type MovementFilters } from "./movements";

// The logic of the Inicio's dashboard (FE-35, KAN-101; the screen is KAN-84, docs/diseno.md D9 and
// D17 › Escritorio v2): what the cards and the charts say, worked out from `GET /dashboard` and
// `GET /dashboard/series`. Pure: no React, no browser. Amounts come from the backend as JSON
// numbers in the minor unit of the space's currency and **all arithmetic is BigInt**, never floats.
// The sums the backend sends (Disponible, Neto, a month's expenses…) can pass the largest safe
// integer; an amount that does not fit is never shown as if it were exact (`formatDashboardAmount`),
// and a figure that needs two of them (a change, a comparison) is simply left out.

const ZERO = BigInt(0);
const TWO = BigInt(2);
const HUNDRED = BigInt(100);

/** The largest amount JavaScript holds exactly, and the cap the backend gives every single amount. */
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

const MINUS_SIGN = "\u2212";
const NBSP = "\u00A0";

/** A month as a word in a sentence ("setiembre"); a text that is not a month is left as it came. */
function monthWord(month: string): string {
  return isMonth(month) ? formatMonthName(month) : month;
}

// --- Amounts ---------------------------------------------------------------------------------------

/**
 * An amount of the dashboard as text. The backend's totals are sums, so they can be larger than the
 * largest safe integer, and `formatMoney` refuses such a number (the screen would not open). A number
 * that is not a safe integer is not exact any more, so instead of a figure that may be wrong it says
 * so: "Más de $ 90.071.992.547.409,91" (or "Menos de \u2212$ …"), with the largest amount the backend
 * accepts for a single movement. Everything else is `formatMoney`.
 */
export function formatDashboardAmount(
  minor: number,
  currency: Currency,
  options: FormatMoneyOptions = {},
): string {
  if (Number.isSafeInteger(minor)) return formatMoney(minor, currency, options);
  if (Number.isNaN(minor)) return "—";
  return minor > 0
    ? `Más de ${formatMoney(MAX_SAFE, currency)}`
    : `Menos de ${formatMoney(-MAX_SAFE, currency)}`;
}

const percentFormatter = new Intl.NumberFormat(DEFAULT_LOCALE, {
  maximumFractionDigits: 0,
  useGrouping: "always",
});

/** A whole percent as the lists write it, "58 %" (a no-break space before the sign). */
export function formatPercent(percent: number | bigint): string {
  return `${percentFormatter.format(percent)}${NBSP}%`;
}

const compactFormatters = new Map<string, Intl.NumberFormat>();

/**
 * An amount for the labels of a chart's axis, with no currency sign and in words: "25 mil",
 * "1,5 millones", "0", "\u221225 mil". Like `formatMoney` it goes from the exact integer to a decimal
 * **string** (no division) and `Intl` formats that string; `compactDisplay: "long"` is what reads
 * "25 mil" (the short form says "25 k"). The locale is the currency's, as for every amount.
 */
export function formatCompactMoney(minor: MinorAmount, currency: Currency): string {
  const locale = localeForCurrency(currency.code);
  let formatter = compactFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      notation: "compact",
      compactDisplay: "long",
      maximumFractionDigits: 1,
    });
    compactFormatters.set(locale, formatter);
  }
  const decimal = minorToDecimalString(minor, currency.exponent);
  return formatter
    .formatToParts(decimal as Intl.StringNumericLiteral)
    .map((part) => (part.type === "minusSign" ? MINUS_SIGN : part.value))
    .join("");
}

/**
 * The smallest "round" step (1, 2, 2.5 or 5 times a power of ten) whose `intervals` steps reach `max`.
 * A step is a whole number of minor units, so 2.5 only exists from a scale of 10.
 */
function niceStep(max: bigint, intervals: bigint): bigint {
  const ten = BigInt(10);
  for (let scale = BigInt(1); ; scale *= ten) {
    for (const mantissa of [10, 20, 25, 50]) {
      const candidate = BigInt(mantissa) * scale;
      if (candidate % ten !== ZERO) continue;
      const step = candidate / ten;
      if (step * intervals >= max) return step;
    }
  }
}

/**
 * The ticks of a value axis that starts at 0: `count` of them (4 by default, like the canvas), evenly
 * spaced, the last one at or above `max`, with a step of 1, 2, 2.5 or 5 times a power of ten ("0,
 * 25 mil, 50 mil, 75 mil" for a month of 72.500). All BigInt, so a very large maximum is exact; the
 * chart turns them into numbers for its scale. A maximum of 0 or less (nothing to draw) gives
 * 0, 1, 2… and is not meant to be shown.
 */
export function niceTicks(max: bigint, count: number = 4): bigint[] {
  if (!Number.isInteger(count) || count < 2) throw new RangeError(`Invalid tick count: ${count}`);
  const step = max > ZERO ? niceStep(max, BigInt(count - 1)) : BigInt(1);
  return Array.from({ length: count }, (_, index) => BigInt(index) * step);
}

// --- The series ------------------------------------------------------------------------------------

function isActiveMonth(point: MonthlySeriesPoint): boolean {
  return point.income_minor !== 0 || point.expense_minor !== 0 || point.net_minor !== 0;
}

/**
 * Whether there is more history than the current month: some month before the last one has
 * something (income, expense or net). The backend gives exactly the months asked, with 0 where
 * nothing happened, so the months before the first movement look like this: when they are all 0
 * there is a single month of history and a line "from 0" would be a lie (the initial balance is not
 * a gain), so the Inicio leaves out the evolution of the Neto and its change (docs/diseno.md D9).
 */
export function hasHistory(points: readonly MonthlySeriesPoint[]): boolean {
  return points.slice(0, -1).some(isActiveMonth);
}

/** Whether any month has income or expense: with none, the chart of Ingresos y gastos is empty. */
export function hasIncomeOrExpense(points: readonly MonthlySeriesPoint[]): boolean {
  return points.some((point) => point.income_minor !== 0 || point.expense_minor !== 0);
}

export type NetChange = {
  direction: "up" | "down" | "flat";
  /** "+$ 4.330,00 este mes", "\u2212$ 1.200,00 este mes" or "Sin cambios este mes". */
  text: string;
};

/**
 * The chip of the Neto: how much it moved this month. It is the net of today (`/dashboard`) minus the
 * net at the close of the month before (the series' point before the last), so the card's figure
 * and its chip always agree even if a movement lands between the two requests. `null` when there is
 * no history (see `hasHistory`) and when either figure is not exact (`Number.isSafeInteger`).
 */
export function describeNetChange(
  netMinor: number,
  points: readonly MonthlySeriesPoint[],
  currency: Currency,
): NetChange | null {
  if (!hasHistory(points)) return null;
  const previous = points[points.length - 2];
  if (!previous) return null;
  if (!Number.isSafeInteger(netMinor) || !Number.isSafeInteger(previous.net_minor)) return null;
  const delta = BigInt(netMinor) - BigInt(previous.net_minor);
  if (delta === ZERO) return { direction: "flat", text: "Sin cambios este mes" };
  return delta > ZERO
    ? { direction: "up", text: `${formatMoney(delta, currency, { sign: "exceptZero" })} este mes` }
    : { direction: "down", text: `${formatMoney(delta, currency)} este mes` };
}

/**
 * From which day of the month the Inicio compares what was spent with the month before. Before it, a
 * month that has just begun would be set against a whole one ("90 % menos que en setiembre" on the
 * 3rd), a figure that scares and says nothing.
 */
export const EXPENSE_COMPARISON_FROM_DAY = 15;

export type ExpenseComparison = {
  direction: "less" | "more" | "same";
  /** The whole percent, rounded to the nearest with the half up. */
  percent: bigint;
  /** "8 % menos que en setiembre", "12 % más que en setiembre" or "Igual que en setiembre". */
  text: string;
};

/**
 * The note of "Gastos de octubre": what was spent this month against the month before, from the
 * series (the dashboard does not bring it): the last point's `expense_minor` (the whole current
 * month, which is `month_expense_minor`) and the one before it. The percent is an integer rounded to
 * the nearest with the half up, with the formula of the backend's percentages (`(200·part + total)
 * // (2·total)`), so 12,5 is 13. A change that rounds to 0 % reads "Igual que en…".
 *
 * `null` (no note) when: the day is before `EXPENSE_COMPARISON_FROM_DAY`; `today` (the space's day,
 * `YYYY-MM-DD`) is not in the month of the last point; the month before had no expenses (nothing to
 * compare with); or either figure is not an exact integer.
 */
export function compareExpense(
  points: readonly MonthlySeriesPoint[],
  today: string,
): ExpenseComparison | null {
  const current = points[points.length - 1];
  const previous = points[points.length - 2];
  if (!current || !previous) return null;
  if (!isLocalDate(today) || today.slice(0, 7) !== current.month) return null;
  if (Number(today.slice(8, 10)) < EXPENSE_COMPARISON_FROM_DAY) return null;
  if (!Number.isSafeInteger(current.expense_minor)) return null;
  if (!Number.isSafeInteger(previous.expense_minor) || previous.expense_minor <= 0) return null;

  const spent = BigInt(current.expense_minor);
  const before = BigInt(previous.expense_minor);
  const change = spent - before;
  const size = change < ZERO ? -change : change;
  const percent = (HUNDRED * TWO * size + before) / (TWO * before);
  const name = monthWord(previous.month);
  if (percent === ZERO) {
    return { direction: "same", percent, text: `Igual que en ${name}` };
  }
  return change < ZERO
    ? { direction: "less", percent, text: `${formatPercent(percent)} menos que en ${name}` }
    : { direction: "more", percent, text: `${formatPercent(percent)} más que en ${name}` };
}

/**
 * The money a month leaves: income minus expense, as the tooltip's "Ahorro" writes it (with a "\u2212"
 * when the month cost more than it brought). "—" if either figure is not exact.
 */
export function describeMonthSavings(point: MonthlySeriesPoint, currency: Currency): string {
  if (!Number.isSafeInteger(point.income_minor) || !Number.isSafeInteger(point.expense_minor)) {
    return "—";
  }
  return formatMoney(BigInt(point.income_minor) - BigInt(point.expense_minor), currency);
}

const SHORT_MONTH_OPTIONS: Intl.DateTimeFormatOptions = { month: "short", timeZone: "UTC" };

/**
 * A month for the axis of a chart, three letters in capitals with no period, as the canvas draws
 * them: "Oct". es-UY writes the month of September as "setiembre", so the label is "Set". Throws a
 * `RangeError` for a text that is not a month the backend accepts.
 */
export function formatMonthShort(month: string): string {
  if (!isMonth(month)) throw new RangeError(`Expected a YYYY-MM month: "${month}"`);
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1));
  const parts = new Intl.DateTimeFormat(DEFAULT_LOCALE, SHORT_MONTH_OPTIONS).formatToParts(date);
  const name = (parts.find((part) => part.type === "month")?.value ?? "")
    .replace(/\.$/, "")
    .toLocaleLowerCase(DEFAULT_LOCALE);
  return `${name.charAt(0).toLocaleUpperCase(DEFAULT_LOCALE)}${name.slice(1)}`;
}

/**
 * The `aria-label` of the Neto chart (docs/diseno.md D9: every chart says what it shows in text):
 * "Neto de los últimos 6 meses: de $ 71.200,00 en mayo a $ 96.430,00 en octubre". The first and the
 * last point of the series; the last is the net of today.
 */
export function describeNetChartLabel(
  points: readonly MonthlySeriesPoint[],
  currency: Currency,
): string {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return "Neto de los últimos meses: sin datos";
  if (points.length === 1) {
    return `Neto de ${monthWord(last.month)}: ${formatDashboardAmount(last.net_minor, currency)}`;
  }
  return (
    `Neto de los últimos ${points.length} meses: ` +
    `de ${formatDashboardAmount(first.net_minor, currency)} en ${monthWord(first.month)} ` +
    `a ${formatDashboardAmount(last.net_minor, currency)} en ${monthWord(last.month)}`
  );
}

/**
 * The `aria-label` of the Ingresos y gastos chart: the months it covers and the figures of the
 * current one (the last point): "Ingresos y gastos de los últimos 6 meses. En octubre (mes en curso):
 * ingresos $ 68.000,00, gastos $ 36.770,00".
 */
export function describeIncomeExpenseChartLabel(
  points: readonly MonthlySeriesPoint[],
  currency: Currency,
): string {
  const last = points[points.length - 1];
  if (!last) return "Ingresos y gastos de los últimos meses: sin datos";
  const scope =
    points.length === 1
      ? "Ingresos y gastos del mes."
      : `Ingresos y gastos de los últimos ${points.length} meses.`;
  return (
    `${scope} En ${monthWord(last.month)} (mes en curso): ` +
    `ingresos ${formatDashboardAmount(last.income_minor, currency)}, ` +
    `gastos ${formatDashboardAmount(last.expense_minor, currency)}`
  );
}

// --- The top 5 ------------------------------------------------------------------------------------

/** The thinnest a bar of the top 5 is drawn, in percent of the track: a category with something never looks empty. */
export const MIN_BAR_PERCENT = 2;

/**
 * How wide each bar of the top 5 is, in whole percent of the track: relative to the **largest**
 * category (it is 100, as the canvas draws it: 100 %, 29 %, 23 %…), not to the month's total, whose
 * share is the text next to it. Rounded to the nearest with the half up, with BigInt; any
 * amount above 0 is at least `MIN_BAR_PERCENT`, and an amount of 0 or less is 0.
 */
export function topBarWidths(
  categories: readonly Pick<TopExpenseCategory, "amount_minor">[],
): number[] {
  const amounts = categories.map((category) =>
    Number.isInteger(category.amount_minor) ? BigInt(category.amount_minor) : ZERO,
  );
  const largest = amounts.reduce((max, amount) => (amount > max ? amount : max), ZERO);
  return amounts.map((amount) => {
    if (amount <= ZERO || largest <= ZERO) return 0;
    const width = Number((HUNDRED * TWO * amount + largest) / (TWO * largest));
    return Math.min(100, Math.max(MIN_BAR_PERCENT, width));
  });
}

function movementsHref(filters: MovementFilters, currentMonth: string): string {
  const query = serializeMovementFilters(filters, currentMonth).toString();
  return query ? `/movimientos?${query}` : "/movimientos";
}

/**
 * Where "Ver todo" of the top 5 goes: Movimientos with the expenses of the month
 * (`/movimientos?tipo=gastos`; the month is the screen's own when it is the current one).
 */
export function expensesHref(month: string): string {
  return movementsHref({ month, type: "expense" }, month);
}

/**
 * Where a row of the top 5 goes: the expenses of the month in that category
 * (`/movimientos?tipo=gastos&categoria_id=<id>`). `category_id` of the dashboard is the main
 * category and the list's `categoria_id` includes its subcategories, so the movements it shows add
 * up to the row's amount.
 */
export function topCategoryHref(categoryId: string, month: string): string {
  return movementsHref({ month, type: "expense", categoryId }, month);
}

// --- The notes of the cards ------------------------------------------------------------------------

function activeOf(accounts: readonly AccountWithBalance[]): AccountWithBalance[] {
  return accounts.filter((account) => account.archived_at === null);
}

/**
 * The note under Disponible, from the active accounts: "2 bancos y efectivo", "1 banco y efectivo",
 * "3 bancos", "Efectivo" (or "2 cuentas de efectivo"), and "Sin bancos ni efectivo" when there is
 * only a card.
 */
export function describeAvailableNote(accounts: readonly AccountWithBalance[]): string {
  const active = activeOf(accounts);
  const banks = active.filter((account) => account.type === "bank").length;
  const cash = active.filter((account) => account.type === "cash").length;
  if (banks > 0) {
    const text = `${banks} ${banks === 1 ? "banco" : "bancos"}`;
    return cash > 0 ? `${text} y efectivo` : text;
  }
  if (cash === 1) return "Efectivo";
  if (cash > 1) return `${cash} cuentas de efectivo`;
  return "Sin bancos ni efectivo";
}

/** The note under Deuda de tarjetas: "En 2 tarjetas", "En 1 tarjeta" or "Sin tarjetas". */
export function describeDebtNote(accounts: readonly AccountWithBalance[]): string {
  const cards = activeOf(accounts).filter((account) => account.type === "credit_card").length;
  if (cards === 0) return "Sin tarjetas";
  return `En ${cards} ${cards === 1 ? "tarjeta" : "tarjetas"}`;
}

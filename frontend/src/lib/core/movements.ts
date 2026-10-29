import type {
  MovementListItem,
  MovementPage,
  TransactionSummary,
  TransactionType,
} from "./data/transactions";
import { formatLocalDate, formatLocalWeekdayDate, isMonth, shiftLocalDate } from "./dates";
import { describeTransactionStatus, describeTransactionType } from "./i18n";
import { formatMoney, type Currency } from "./money";

// Pure logic of Movimientos (docs/diseno.md D17 › Escritorio v2, D19; FE-32 / KAN-97): the filters
// of the list and their place in the URL, the month, the days the phone groups by, and how each
// movement is told in a row, in a table and in the summary. No React and no browser: the screen
// (FE-22 / KAN-82) and the other lists of movements (the Inicio, the detail of an account) use it.

// --- The filters and the URL -----------------------------------------------------------------------

/** The types the chips can ask for. "Todos" is no type, and adjustments have no chip (they show in "Todos"). */
export type MovementTypeFilter = Exclude<TransactionType, "adjustment">;

/**
 * What narrows the list: always a month (the current one until the person moves), and optionally
 * a type, a text for the description, an account and a category. It is a `TransactionFilters`
 * with the month required, so it goes to the data layer as it is.
 */
export type MovementFilters = {
  month: string;
  type?: MovementTypeFilter;
  q?: string;
  accountId?: string;
  categoryId?: string;
};

/**
 * The query params of the screen (`/movimientos?mes=2026-09&tipo=gastos&q=uber&cuenta_id=…`).
 * `cuenta` and `categoria` are not used on purpose: they are the params of the side panels
 * (`?cuenta=nueva`, `?categoria=editar`), and `sel` and `movimiento` too.
 */
export const MOVEMENT_PARAMS = {
  month: "mes",
  type: "tipo",
  q: "q",
  accountId: "cuenta_id",
  categoryId: "categoria_id",
} as const;

/** `?tipo=` for each type (Todos is no param), in the words of `?tipo=gastos|ingresos` of Categorías. */
export const MOVEMENT_TYPE_PARAMS = {
  expense: "gastos",
  income: "ingresos",
  transfer: "transferencias",
} as const satisfies Record<MovementTypeFilter, string>;

/** The longest search the backend takes (`q`, 1 to 100 characters). */
export const MOVEMENT_SEARCH_MAX_LENGTH = 100;

/** The first and the last month the backend accepts in `?month=` (its pattern is years 1900 to 2199). */
export const MIN_MONTH = "1900-01";
export const MAX_MONTH = "2199-12";

/** The type a `?tipo=` value names; a value that is not one of the three is `undefined` (Todos). */
export function movementTypeFromParam(
  param: string | null | undefined,
): MovementTypeFilter | undefined {
  if (!param) return undefined;
  for (const type of Object.keys(MOVEMENT_TYPE_PARAMS) as MovementTypeFilter[]) {
    if (MOVEMENT_TYPE_PARAMS[type] === param) return type;
  }
  return undefined;
}

/**
 * Where the params come from: a `URLSearchParams` (the client's `useSearchParams()`) or the plain
 * object a Next.js page gets as `searchParams` (a repeated param is an array: the first counts, as
 * with `URLSearchParams.get`).
 */
export type ParamSource =
  | { get(name: string): string | null }
  | Readonly<Record<string, string | readonly string[] | undefined>>;

function readParam(source: ParamSource, name: string): string | undefined {
  const maybeGet = (source as { get?: unknown }).get;
  if (typeof maybeGet === "function") {
    return (source as { get(name: string): string | null }).get(name) ?? undefined;
  }
  const record = source as Readonly<Record<string, string | readonly string[] | undefined>>;
  if (!Object.hasOwn(record, name)) return undefined;
  const value = record[name];
  return typeof value === "string" ? value : value?.[0];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id as the backend takes it, in the one form the key of the query uses; anything else is left out (it would be a 422). */
function normalizeId(text: string | undefined): string | undefined {
  return text !== undefined && UUID.test(text) ? text.toLowerCase() : undefined;
}

/**
 * The text of a search as it is sent: without spaces at the ends, and `undefined` if nothing is
 * left (the backend refuses an empty `q`). A longer one is cut to the 100 characters the backend
 * takes, counting code points as it does, so a pasted paragraph or an emoji at the limit is not a 422.
 */
export function normalizeSearch(text: string | null | undefined): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) return undefined;
  const cut = [...trimmed].slice(0, MOVEMENT_SEARCH_MAX_LENGTH).join("").trim();
  return cut === "" ? undefined : cut;
}

/**
 * The filters a URL says. It never fails: a month that is not one, a type that is not one of the
 * three, an id that is not a UUID or an empty search are left out, as if the param was not there
 * (the month falls to `currentMonth`, the current one in the space's zone). The server page and the
 * client read the same URL with this function, so they ask for the same thing.
 */
export function parseMovementFilters(source: ParamSource, currentMonth: string): MovementFilters {
  const month = readParam(source, MOVEMENT_PARAMS.month);
  const filters: MovementFilters = {
    month: month !== undefined && isMonth(month) ? month : currentMonth,
  };
  const type = movementTypeFromParam(readParam(source, MOVEMENT_PARAMS.type));
  if (type) filters.type = type;
  const q = normalizeSearch(readParam(source, MOVEMENT_PARAMS.q));
  if (q) filters.q = q;
  const accountId = normalizeId(readParam(source, MOVEMENT_PARAMS.accountId));
  if (accountId) filters.accountId = accountId;
  const categoryId = normalizeId(readParam(source, MOVEMENT_PARAMS.categoryId));
  if (categoryId) filters.categoryId = categoryId;
  return filters;
}

/**
 * `search` with the five params of the filters replaced by these `filters`, and every other param
 * (`movimiento`, `sel`…) as it was. What is the default is not written: the current month, "Todos",
 * no search, "Todas las cuentas" and "Todas las categorías", so `/movimientos` alone is the
 * default view. Returns a new `URLSearchParams`; the caller writes it with `history.replaceState`.
 */
export function applyMovementFilters(
  search: URLSearchParams | string,
  filters: MovementFilters,
  currentMonth: string,
): URLSearchParams {
  const next = new URLSearchParams(search);
  for (const name of Object.values(MOVEMENT_PARAMS)) next.delete(name);
  if (isMonth(filters.month) && filters.month !== currentMonth) {
    next.set(MOVEMENT_PARAMS.month, filters.month);
  }
  if (filters.type) next.set(MOVEMENT_PARAMS.type, MOVEMENT_TYPE_PARAMS[filters.type]);
  const q = normalizeSearch(filters.q);
  if (q) next.set(MOVEMENT_PARAMS.q, q);
  if (filters.accountId) next.set(MOVEMENT_PARAMS.accountId, filters.accountId);
  if (filters.categoryId) next.set(MOVEMENT_PARAMS.categoryId, filters.categoryId);
  return next;
}

/** The params of these filters alone (`applyMovementFilters` on an empty URL). */
export function serializeMovementFilters(
  filters: MovementFilters,
  currentMonth: string,
): URLSearchParams {
  return applyMovementFilters("", filters, currentMonth);
}

/**
 * How many filters the "Filtrar" sheet holds that are on: the account and the category. They are
 * the ones the screen does not show (the type, the month and the search have their own control),
 * so the button counts them.
 */
export function activeFilterCount(filters: MovementFilters): number {
  return (filters.accountId ? 1 : 0) + (filters.categoryId ? 1 : 0);
}

/** Whether anything narrows the list besides the month: what "Quitar filtros" would take away. */
export function hasActiveFilters(filters: MovementFilters): boolean {
  return Boolean(filters.type || filters.q || filters.accountId || filters.categoryId);
}

/** "Quitar filtros": the same month with nothing else (moving between months is the month's own control). */
export function clearMovementFilters(filters: MovementFilters): MovementFilters {
  return { month: filters.month };
}

/** The name of the "Filtrar" button: "Filtrar", "Filtrar, 1 filtro activo" or "Filtrar, 2 filtros activos". */
export function describeFilterButton(count: number): string {
  if (count <= 0) return "Filtrar";
  return `Filtrar, ${count} ${count === 1 ? "filtro activo" : "filtros activos"}`;
}

// --- The month -------------------------------------------------------------------------------------

/**
 * The month `delta` months after (or before, if negative) `month`, as `YYYY-MM`, or `null` when
 * it would leave the months the backend takes (`MIN_MONTH` to `MAX_MONTH`): the button of that
 * direction is off. Throws a `RangeError` for a text that is not a month or a `delta` that is not an integer.
 */
export function shiftMonth(month: string, delta: number): string | null {
  if (!isMonth(month)) throw new RangeError(`Expected a YYYY-MM month: "${month}"`);
  if (!Number.isInteger(delta)) throw new RangeError(`Expected a whole number of months: ${delta}`);
  const index = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + delta;
  const year = Math.floor(index / 12);
  const number = index - year * 12 + 1;
  const shifted = `${String(year).padStart(4, "0")}-${String(number).padStart(2, "0")}`;
  return isMonth(shifted) ? shifted : null;
}

// --- The days of the phone -------------------------------------------------------------------------

/** The movements of one day, with the title of the group ("Hoy · jueves 22 de octubre"). */
export type DayGroup<T extends { date: string }> = {
  date: string;
  title: string;
  items: T[];
};

function lowerFirst(text: string): string {
  return text.charAt(0).toLocaleLowerCase("es") + text.slice(1);
}

function yearOf(date: string): string {
  return date.slice(0, 4);
}

/**
 * The title of the group of a day (docs/diseno.md D19): "Hoy · jueves 22 de octubre", "Ayer ·
 * martes 20 de octubre" or the date with its weekday ("Lunes 19 de octubre", with the year when it
 * is not the current one). A date that is not a real day is shown as it came, so one bad row cannot
 * take the screen down.
 */
export function describeDayTitle(date: string, today: string): string {
  let yesterday: string | null = null;
  try {
    yesterday = shiftLocalDate(today, -1);
  } catch {
    // `today` is not a real day: nothing is "Hoy" or "Ayer", and no year is "the current one".
  }
  try {
    if (date === today) return `Hoy · ${lowerFirst(formatLocalWeekdayDate(date))}`;
    if (date === yesterday) return `Ayer · ${lowerFirst(formatLocalWeekdayDate(date))}`;
    return formatLocalWeekdayDate(date, { year: yearOf(date) !== yearOf(today) });
  } catch {
    return date;
  }
}

/**
 * The movements grouped by day, in the order they come (newest first: a day is a run of equal
 * dates, so a day split between two pages is one group once both are loaded). `today` is the
 * space's day (`todayInTimezone(space.timezone)`), which is what "Hoy" and "Ayer" mean.
 */
export function groupMovementsByDay<T extends { date: string }>(
  items: readonly T[],
  today: string,
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.date === item.date) {
      last.items.push(item);
    } else {
      groups.push({ date: item.date, title: describeDayTitle(item.date, today), items: [item] });
    }
  }
  return groups;
}

/** The date of a row of the table ("20 oct."), with the year when it is not the current one (`today`, if known). */
export function formatMovementDate(date: string, today?: string): string {
  try {
    const sameYear = today === undefined || yearOf(date) === yearOf(today);
    return formatLocalDate(date, sameYear ? "short" : "medium");
  } catch {
    return date;
  }
}

// --- How a movement is told ------------------------------------------------------------------------

/** What of a movement the descriptions read: the list item and the detail share it. */
export type MovementLike = Pick<
  MovementListItem,
  "type" | "status" | "description" | "category" | "account" | "from_account" | "to_account"
>;

/** A transfer and an adjustment are quiet: no color, no category tile (docs/diseno.md D19). */
export function isQuietMovement(item: Pick<MovementListItem, "type">): boolean {
  return item.type === "transfer" || item.type === "adjustment";
}

function joinParts(parts: readonly (string | null | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(" · ");
}

/** "Itaú → Visa Itaú", or `null` if a name is missing. */
function transferText(item: MovementLike): string | null {
  const from = item.from_account?.name;
  const to = item.to_account?.name;
  return from && to ? `${from} → ${to}` : null;
}

/**
 * What the row calls a movement: its description; without one, the category of an expense or an
 * income, the two accounts of a transfer ("Itaú → Visa Itaú") or the type ("Ajuste"). Never empty
 * and never a raw value of the backend.
 */
export function describeMovementTitle(item: MovementLike): string {
  const description = item.description?.trim();
  if (description) return description;
  if (item.type === "transfer") return transferText(item) ?? describeTransactionType(item.type);
  if (item.type === "expense" || item.type === "income") {
    return item.category?.name || describeTransactionType(item.type);
  }
  return describeTransactionType(item.type);
}

/** The state of a movement that is not confirmed ("Pendiente", "Omitido"), or `null` when it is. */
export function describeMovementStatusNote(item: Pick<MovementLike, "status">): string | null {
  return item.status === "confirmed" ? null : describeTransactionStatus(item.status);
}

/**
 * The line under the title on the phone (docs/diseno.md D19): "Supermercado · Visa Itaú" for an
 * expense or an income (the category's own name, not its principal), "Transferencia · Itaú → Visa
 * Itaú" and "Ajuste · Efectivo". A movement that is not confirmed ends with its state.
 */
export function describeMovementSubline(item: MovementLike): string {
  const type = describeTransactionType(item.type);
  let line: string;
  if (item.type === "transfer") {
    line = joinParts([type, transferText(item)]);
  } else if (item.type === "adjustment") {
    line = joinParts([type, item.account?.name]);
  } else {
    line = joinParts([item.category?.name, item.account?.name]) || type;
  }
  return joinParts([line, describeMovementStatusNote(item)]);
}

/**
 * The "Categoría" cell of the table: "Comida › Supermercado" for a subcategory, the name of a
 * principal, and "Transferencia" or "Ajuste" (which have no category), the last two `quiet`.
 */
export function describeMovementCategory(item: MovementLike): { label: string; quiet: boolean } {
  if (item.type === "transfer" || item.type === "adjustment") {
    return { label: describeTransactionType(item.type), quiet: true };
  }
  const category = item.category;
  if (!category) return { label: "Sin categoría", quiet: true };
  return {
    label: category.parent ? `${category.parent.name} › ${category.name}` : category.name,
    quiet: false,
  };
}

/** The "Cuenta" cell of the table: the account, or "Itaú → Visa Itaú" in a transfer. */
export function describeMovementAccount(item: MovementLike): string {
  if (item.type === "transfer") return transferText(item) ?? "Sin cuenta";
  return item.account?.name || "Sin cuenta";
}

// --- Amounts ---------------------------------------------------------------------------------------

/** How an amount is painted: `income` is `text-income`, `default` the text color, `muted` the quiet one. */
export type AmountTone = "income" | "default" | "muted";

export type AmountView = { text: string; tone: AmountTone };

/**
 * The amount of a movement as the lists write it (docs/diseno.md D19). The sign comes from the
 * **type**, not from trusting the number: an expense is "−" in the text color, an income is "+"
 * in `income`, a transfer has no sign and is quiet, and an adjustment keeps the sign it carries
 * (it raises or lowers a balance) and is quiet. `amount_minor` is in the minor unit of the
 * currency of the space; the formatting is `formatMoney`, with no float arithmetic (BigInt).
 */
export function movementAmountView(
  item: Pick<MovementListItem, "type" | "amount_minor">,
  currency: Currency,
): AmountView {
  const minor = BigInt(item.amount_minor);
  const magnitude = minor < BigInt(0) ? -minor : minor;
  switch (item.type) {
    case "expense":
      return { text: formatMoney(-magnitude, currency), tone: "default" };
    case "income":
      return { text: formatMoney(magnitude, currency, { sign: "exceptZero" }), tone: "income" };
    case "transfer":
      return { text: formatMoney(magnitude, currency, { sign: "never" }), tone: "muted" };
    default:
      return { text: formatMoney(minor, currency, { sign: "exceptZero" }), tone: "muted" };
  }
}

/** One figure of the summary: its label, the text and how it is painted. */
export type SummaryFigure = { label: string; text: string; tone: AmountTone };

/**
 * The three figures of the period (docs/diseno.md D19): "Ingresos" with "+" in `income` (the
 * text color when there are none), "Gastos" with "−" and "Te quedan" with its own sign. The
 * backend sends income and expense as positive amounts and `remaining_minor` as their difference.
 */
export function summaryFigures(
  summary: TransactionSummary,
  currency: Currency,
): { income: SummaryFigure; expense: SummaryFigure; remaining: SummaryFigure } {
  const income = BigInt(summary.income_minor);
  const expense = BigInt(summary.expense_minor);
  return {
    income: {
      label: "Ingresos",
      text: formatMoney(income, currency, { sign: "exceptZero" }),
      tone: income > BigInt(0) ? "income" : "default",
    },
    expense: {
      label: "Gastos",
      text: formatMoney(-expense, currency, { sign: "exceptZero" }),
      tone: "default",
    },
    remaining: {
      label: "Te quedan",
      text: formatMoney(summary.remaining_minor, currency, { sign: "exceptZero" }),
      tone: "default",
    },
  };
}

/** Whether the summary is shown: with "Transferencias" there is nothing to add up (they are not income nor expense). */
export function showsSummary(filters: Pick<MovementFilters, "type">): boolean {
  return filters.type !== "transfer";
}

// --- Counts ----------------------------------------------------------------------------------------

const COUNT_FORMAT = new Intl.NumberFormat("es-UY", { useGrouping: "always" });

/** "48 movimientos", "1 movimiento", "0 movimientos": the subtitle of the header. */
export function describeMovementCount(count: number): string {
  return `${COUNT_FORMAT.format(count)} ${count === 1 ? "movimiento" : "movimientos"}`;
}

/**
 * "Mostrando 14 de 48 movimientos" (D17 › Escritorio v2). `total` is the `count` of the summary,
 * which can lag behind the list for an instant after a change, so it is never less than what is shown.
 */
export function describeShown(shown: number, total: number): string {
  const all = Math.max(total, shown);
  return `Mostrando ${COUNT_FORMAT.format(shown)} de ${describeMovementCount(all)}`;
}

/** The movements of every loaded page, in order. */
export function flattenMovementPages(
  data: { pages: readonly MovementPage[] } | undefined,
): MovementListItem[] {
  return data ? data.pages.flatMap((page) => page.items) : [];
}

import type { AccountType } from "./data/accounts";
import type { MovementListItem, TransactionSummary } from "./data/transactions";
import { formatMonthName } from "./dates";
import { formatMoney, type Currency } from "./money";
import type { AmountView } from "./movements";

// Pure logic of the detail of an account (docs/diseno.md D17 › Escritorio v2, D18; FE-26 / KAN-89):
// how the movements of ONE account are told, the Saldo / Deuda column, the figure of the month and the
// texts of the empty state. No React and no browser. Money is BigInt and `formatMoney`: no floats.

/** The part of an account these functions look at. */
export type AccountRef = { id: string; type: AccountType };

const ZERO = BigInt(0);

function absolute(minor: bigint): bigint {
  return minor < ZERO ? -minor : minor;
}

type MovementOfAccount = Pick<
  MovementListItem,
  "type" | "amount_minor" | "account" | "from_account" | "to_account"
>;

/**
 * How much a movement moved the balance of `accountId`, with the sign of the backend's
 * `balance_minor` (on a credit card, negative = the debt grew). The sign comes from the **type**, not
 * from trusting the number: an expense lowers the balance, an income raises it, an adjustment carries
 * its own sign, and a transfer raises the balance of the account it goes **to** and lowers the one it
 * comes **from** (it arrives unsigned). A movement that is of another account, or a transfer that
 * does not touch this one, moves nothing.
 */
export function balanceDelta(item: MovementOfAccount, accountId: string): bigint {
  const minor = BigInt(item.amount_minor);
  if (item.type !== "transfer" && item.account && item.account.id !== accountId) return ZERO;
  switch (item.type) {
    case "expense":
      return -absolute(minor);
    case "income":
      return absolute(minor);
    case "transfer":
      if (item.to_account?.id === accountId) return absolute(minor);
      if (item.from_account?.id === accountId) return -absolute(minor);
      return ZERO;
    default:
      return minor;
  }
}

/**
 * The "Monto" cell of the table of an account (K-V2-Escritorio, "cuentas"). In a bank or cash account
 * it is the change of the balance with its sign: "−" an expense, "+" an income, "+" or "−" a transfer
 * by its direction. In a **card** it is read as debt, so it is the opposite: a purchase has no sign
 * (the debt grows) and what lowers the debt (a payment received, a refund, an adjustment down) goes
 * with "−". The tone follows the type, as in the other lists: an income in `income`, an expense in the
 * text color and a transfer or an adjustment quiet.
 */
export function accountAmountView(
  item: MovementOfAccount,
  account: AccountRef,
  currency: Currency,
): AmountView {
  const delta = balanceDelta(item, account.id);
  const text =
    account.type === "credit_card"
      ? formatMoney(-delta, currency)
      : formatMoney(delta, currency, { sign: "exceptZero" });
  const tone = item.type === "income" ? "income" : item.type === "expense" ? "default" : "muted";
  return { text, tone };
}

/** "Saldo" for a bank or cash account, "Deuda" for a card: the head of the last column. */
export function balanceColumnLabel(type: AccountType): "Saldo" | "Deuda" {
  return type === "credit_card" ? "Deuda" : "Saldo";
}

/**
 * The last cell of a row: the balance of the account right after the movement (the backend's
 * `balance_after_minor`, never computed here), or the debt for a card (its opposite). `null` for a
 * movement that does not count for a balance (pending or skipped): the row shows a dash.
 */
export function balanceAfterText(
  item: Pick<MovementListItem, "balance_after_minor">,
  type: AccountType,
  currency: Currency,
): string | null {
  const minor = item.balance_after_minor;
  if (minor === null || minor === undefined) return null;
  const balance = BigInt(minor);
  return formatMoney(type === "credit_card" ? -balance : balance, currency);
}

/** The figure of the month under the header: its label ("Movimiento neto de octubre") and the amount. */
export type MonthFigure = { label: string; text: string };

/**
 * The name of a month for a sentence about an account: "octubre", with the year ("octubre de 2025")
 * when the month is not of the current year.
 */
export function monthNameFor(month: string, currentMonth: string): string {
  return formatMonthName(month, { withYear: month.slice(0, 4) !== currentMonth.slice(0, 4) });
}

/**
 * The label of the figure of the month (K-V2-Escritorio): "Movimiento neto de octubre" for a bank or
 * cash account and "Consumos de octubre" for a card. It does not need the data, so it stays on screen
 * while the figure loads or fails.
 */
export function monthFigureLabel(type: AccountType, month: string, currentMonth: string): string {
  const name = monthNameFor(month, currentMonth);
  return type === "credit_card" ? `Consumos de ${name}` : `Movimiento neto de ${name}`;
}

/**
 * The amount of the figure of the month, from the summary of the account and the month:
 *
 * - **Net movement** (bank or cash) is how much the balance of the account moved in the month: the
 *   backend's `balance_change_minor` (BE-25), which counts incomes, expenses, transfers in and out and
 *   adjustments, with a sign ("+ $ 45.350,00"). It does not follow the type filter. It comes only with
 *   `account_id`: without it there is no figure, `null`, which the screen treats as a failed summary
 *   and **never as 0**.
 * - **Consumos** (card) is what the card was spent on in the month: the summary's `expense_minor`,
 *   unsigned.
 */
export function monthFigureText(
  summary: Pick<TransactionSummary, "balance_change_minor" | "expense_minor">,
  type: AccountType,
  currency: Currency,
): string | null {
  if (type === "credit_card") {
    return formatMoney(BigInt(summary.expense_minor), currency, { sign: "never" });
  }
  const change = summary.balance_change_minor;
  if (change === null || change === undefined) return null;
  return formatMoney(BigInt(change), currency, { sign: "exceptZero" });
}

/** `monthFigureLabel` and `monthFigureText` together; `null` when the amount is missing. */
export function describeMonthFigure(
  summary: Pick<TransactionSummary, "balance_change_minor" | "expense_minor">,
  type: AccountType,
  month: string,
  currentMonth: string,
  currency: Currency,
): MonthFigure | null {
  const text = monthFigureText(summary, type, currency);
  return text === null ? null : { label: monthFigureLabel(type, month, currentMonth), text };
}

/**
 * The text of an account's table with no rows. With a type chosen it is about the type ("No hay
 * movimientos de este tipo", with "Quitar filtro"); without it, about the month: "este mes" for the
 * current one and "en septiembre" (with the year when it is not this year's) for the others.
 */
export function describeAccountEmpty(
  month: string,
  currentMonth: string,
  filtered: boolean,
): string {
  if (filtered) return "No hay movimientos de este tipo";
  return month === currentMonth
    ? "Esta cuenta no tiene movimientos este mes"
    : `Esta cuenta no tiene movimientos en ${monthNameFor(month, currentMonth)}`;
}

/** What a screen reader hears as the name of the table: "Movimientos de Itaú en octubre 2026". */
export function describeAccountTableCaption(accountName: string, period: string): string {
  return `Movimientos de ${accountName} en ${period}`;
}

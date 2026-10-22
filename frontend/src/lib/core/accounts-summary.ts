import type { AccountWithBalance } from "./data/accounts";
import { describeAccountType } from "./i18n";

/** Totals of a list of accounts, in the minor unit of the space's currency (exact integers). */
export type AccountsTotals = {
  /** Bank and cash accounts added up. */
  available: bigint;
  /** What the cards owe, positive when you owe (the opposite of their balance). */
  debt: bigint;
  /** What you have minus what you owe. */
  net: bigint;
};

/** A card is shown by what it owes: the opposite of its balance (an integer negation). */
export function displayedAmount(account: AccountWithBalance): bigint {
  const balance = BigInt(account.balance_minor);
  return account.type === "credit_card" ? -balance : balance;
}

/**
 * Disponible (bank + cash), Deuda (cards, sign inverted) and Neto (disponible − deuda), docs/diseno.md
 * D18. BigInt on purpose: a sum of amounts near the backend's cap (9007199254740991) is no longer a
 * safe integer, and floats are never used. Archived accounts do not count. A card paid in excess
 * has a negative debt, and it is not clamped, so the net always adds up (as `balance-summary`).
 */
export function summarizeAccounts(accounts: readonly AccountWithBalance[]): AccountsTotals {
  let available = BigInt(0);
  let debt = BigInt(0);
  for (const account of accounts) {
    if (account.archived_at !== null) continue;
    if (account.type === "credit_card") debt += displayedAmount(account);
    else available += displayedAmount(account);
  }
  return { available, debt, net: available - debt };
}

/** The active accounts and the archived ones, each in the order the backend sent (by name). */
export function splitArchived(accounts: readonly AccountWithBalance[]): {
  active: AccountWithBalance[];
  archived: AccountWithBalance[];
} {
  const active: AccountWithBalance[] = [];
  const archived: AccountWithBalance[] = [];
  for (const account of accounts) (account.archived_at === null ? active : archived).push(account);
  return { active, archived };
}

/**
 * The account the detail shows: the one `?sel` names if it is active; otherwise (no param, an
 * archived account, an id that does not exist) the first active one in the list order, Disponible
 * before Deuda as the screen draws them. `undefined` when there is no active account.
 */
export function selectedAccount(
  active: readonly AccountWithBalance[],
  sel: string | null | undefined,
): AccountWithBalance | undefined {
  const { available, cards } = groupAccounts(active);
  return [...available, ...cards].find((account) => account.id === sel) ?? available[0] ?? cards[0];
}

/** Disponible (bank and cash) and Deuda (cards) groups, each in its original order. */
export function groupAccounts(accounts: readonly AccountWithBalance[]): {
  available: AccountWithBalance[];
  cards: AccountWithBalance[];
} {
  return {
    available: accounts.filter((account) => account.type !== "credit_card"),
    cards: accounts.filter((account) => account.type === "credit_card"),
  };
}

/**
 * The small line under an account's name: its type, or for a card the days it closes and is due
 * ("Cierra el 5 · vence el 12", docs/diseno.md D18).
 */
export function accountMetaLine(account: AccountWithBalance): string {
  if (account.type === "credit_card" && account.closing_day && account.due_day) {
    return `Cierra el ${account.closing_day} · vence el ${account.due_day}`;
  }
  return describeAccountType(account.type);
}

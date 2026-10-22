import type { AccountReconcile, AccountWithBalance } from "./data/accounts";
import { formatMoney, parseMoneyInput, type Currency } from "./money";
import { describeMoneyInputIssue } from "./schemas/money-input";

type ReconcilableAccount = Pick<AccountWithBalance, "type" | "balance_minor">;

/** What typing the real balance means (docs/diseno.md D18 › Cuadrar saldo). */
export type ReconcilePreview =
  | { kind: "empty" }
  | { kind: "invalid"; message: string }
  /** The real balance is the one Kanza has: nothing is registered. */
  | { kind: "same" }
  /** `delta` is the real balance minus the one in Kanza, with the sign of `balance_minor`. */
  | { kind: "change"; delta: bigint; body: AccountReconcile };

/**
 * Compares what the person typed with the balance in Kanza, with integers only (the amount is read
 * in the minor unit and subtracted as BigInt: no floats). A credit card's real debt is written
 * **positive** and is sent as a negative balance (zero is zero). Zero is a valid balance.
 */
export function previewReconcile(
  text: string,
  account: ReconcilableAccount,
  currency: Currency,
): ReconcilePreview {
  const isCard = account.type === "credit_card";
  const parsed = parseMoneyInput(text, currency.exponent, { allowNegative: !isCard });
  if (!parsed.ok) {
    if (parsed.issue === "empty") return { kind: "empty" };
    return {
      kind: "invalid",
      message: describeMoneyInputIssue(parsed.issue, { exponent: currency.exponent, debt: isCard }),
    };
  }
  const real = isCard && parsed.minor !== 0 ? -parsed.minor : parsed.minor;
  const delta = BigInt(real) - BigInt(account.balance_minor);
  if (delta === BigInt(0)) return { kind: "same" };
  return { kind: "change", delta, body: { balance_minor: real } };
}

const NO_COUNT = "No cuenta como ingreso ni gasto.";

const EMPTY_TEXT: Record<AccountWithBalance["type"], string> = {
  bank: "Escribe el saldo que ves en tu banco.",
  cash: "Escribe el saldo que tienes en efectivo.",
  credit_card: "Escribe el saldo que dice el resumen de tu tarjeta.",
};

/** The line under the field, in `aria-live="polite"`: what will be registered. */
export function describeReconcilePreview(
  preview: ReconcilePreview,
  account: ReconcilableAccount,
  currency: Currency,
): string {
  switch (preview.kind) {
    case "empty":
      return EMPTY_TEXT[account.type];
    case "invalid":
      return preview.message;
    case "same":
      return "El saldo ya coincide: no se registra ningún ajuste.";
    case "change": {
      if (account.type === "credit_card") {
        // The debt is the opposite of the balance: the balance going down is the debt going up.
        const up = preview.delta < BigInt(0);
        const amount = formatMoney(up ? -preview.delta : preview.delta, currency);
        return `Tu deuda ${up ? "sube" : "baja"} ${amount}. ${NO_COUNT}`;
      }
      return `Se registrará un ajuste de ${formatMoney(preview.delta, currency, { sign: "exceptZero" })}. ${NO_COUNT}`;
    }
  }
}

/** The label of the field, by type. */
export const RECONCILE_LABEL: Record<AccountWithBalance["type"], string> = {
  bank: "Saldo real en tu banco",
  cash: "Efectivo que tienes",
  credit_card: "Deuda real de la tarjeta",
};

import { z } from "zod";
import type { AccountCreate } from "../data/accounts";
import { parseMoneyInput } from "../money";
import { describeMoneyInputIssue } from "./money-input";

/**
 * Schema of the "Nueva cuenta" form (docs/diseno.md D18). The form holds text (what the person
 * typed and what the `<select>` of days gives back); the schema checks it and **transforms it into
 * the body of `POST /spaces/{space_id}/accounts`** (`AccountCreate`): the balance becomes an integer
 * in the minor unit of the space's currency, and the days become numbers.
 *
 * Messages are the Spanish text shown under each field.
 */

/** The database caps an account name at 80 characters (`ck_accounts_name_length`). */
export const ACCOUNT_NAME_MAX_LENGTH = 80;

const NAME_REQUIRED = "Escribe un nombre.";
const DAY_REQUIRED = "Elige un día del 1 al 31.";

// A day of the month as the `<select>` gives it back: "1" to "31", or "" for "Elige".
const DAY = /^(?:[1-9]|[12]\d|3[01])$/;

/**
 * `exponent` is the one of the space's currency (`SpaceRead.currency.exponent`): it decides how many
 * decimals the balance accepts and how it becomes an integer.
 *
 * - **Balance (optional).** Bank and cash: "Saldo actual", a leading minus is allowed (an
 *   overdraft). Credit card: "Deuda actual", written positive and sent **negative** (the backend
 *   keeps a card's debt with the sign of `balance_minor`). Empty or zero means "nothing to
 *   register", so the field is left out of the body and no adjustment is created.
 * - **Days.** Required on a credit card (no default: a day picked for the person would feed "cuánto
 *   pagar" with a made-up date). On bank and cash they are dropped even if the form still holds
 *   them from another tab, because the backend refuses them (`card_day_not_allowed`).
 */
export function accountFormSchema(exponent: number) {
  return (
    z
      .object({
        type: z.enum(["bank", "cash", "credit_card"], { error: "Elige un tipo de cuenta." }),
        name: z
          .string({ error: NAME_REQUIRED })
          .trim()
          .min(1, NAME_REQUIRED)
          .max(ACCOUNT_NAME_MAX_LENGTH, `Usa como máximo ${ACCOUNT_NAME_MAX_LENGTH} caracteres.`),
        balance: z.string({ error: "Escribe un monto." }),
        closingDay: z.string(),
        dueDay: z.string(),
      })
      // The balance and the days depend on the type, so they are checked together. Zod runs this
      // even when the name failed its own checks (a `.transform` would not), so the person sees
      // every problem at once instead of one per attempt (account.test.ts holds that).
      .check((context) => {
        const { issues } = buildAccountBody(context.value, exponent);
        for (const issue of issues) {
          context.issues.push({
            code: "custom",
            input: context.value,
            path: [issue.path],
            message: issue.message,
          });
        }
      })
      .transform((values): AccountCreate => {
        // Only reached when nothing above failed, so the body is complete.
        return buildAccountBody(values, exponent).body;
      })
  );
}

type FormFields = {
  type: AccountCreate["type"];
  name: string;
  balance: string;
  closingDay: string;
  dueDay: string;
};

/** The body for the values of the form, and the problems found on the way (by form field). */
function buildAccountBody(
  values: FormFields,
  exponent: number,
): { body: AccountCreate; issues: { path: keyof FormFields; message: string }[] } {
  const isCard = values.type === "credit_card";
  const body: AccountCreate = { type: values.type, name: values.name };
  const issues: { path: keyof FormFields; message: string }[] = [];

  const balance = parseMoneyInput(values.balance, exponent, { allowNegative: !isCard });
  if (balance.ok) {
    if (balance.minor !== 0) body.initial_balance_minor = isCard ? -balance.minor : balance.minor;
  } else if (balance.issue !== "empty") {
    issues.push({
      path: "balance",
      message: describeMoneyInputIssue(balance.issue, { exponent, debt: isCard }),
    });
  }

  if (isCard) {
    for (const [field, path, text] of [
      ["closing_day", "closingDay", values.closingDay],
      ["due_day", "dueDay", values.dueDay],
    ] as const) {
      if (DAY.test(text)) body[field] = Number(text);
      else issues.push({ path, message: DAY_REQUIRED });
    }
  }

  return { body, issues };
}

/** What the form holds: all text, before the schema checks it. */
export type AccountFormValues = z.input<ReturnType<typeof accountFormSchema>>;

// Contract check (frontend/CLAUDE.md > Formularios). The form's values are not the request body,
// so what must match the generated type is the schema's **output**. What really holds it is the
// type `AccountCreate` on `body` in `buildAccountBody` and on the return of the `.transform`: a
// field the backend does not have, or one of the wrong type, fails `npm run typecheck` there. This
// line is only a second net, in case someone drops those annotations and the output drifts.
const _check: AccountCreate = {} as z.output<ReturnType<typeof accountFormSchema>>;
void _check;

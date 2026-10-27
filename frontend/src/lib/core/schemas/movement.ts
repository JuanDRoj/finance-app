import { z } from "zod";
import type { MovementCreate, MovementType } from "../data/transactions";
import { isLocalDate } from "../dates";
import { fieldErrorMessage } from "../i18n";
import { moneyAmountSchema } from "./money-input";

/**
 * Schema of the "Registrar movimiento" form (docs/diseno.md D17 › Escritorio v2, D19). The form
 * holds text (what the person typed and what the `<select>`s and the date input give back); the
 * schema checks it and **transforms it into the body of `POST /spaces/{space_id}/transactions`**
 * (`MovementCreate`, the union by `type`): the amount becomes an integer in the minor unit of the
 * space's currency (`moneyAmountSchema`) and each type keeps only its own fields.
 *
 * It is one flat object for the three types, not a union, because the form keeps its values while
 * the person switches the type (the amount, the account, the date and the description stay).
 * `accountId` is the "Cuenta" of an expense or an income and the "Desde" of a transfer. Messages
 * are the Spanish text shown under each field.
 */

/** The kinds of movement a person registers by hand (an adjustment only comes from "Cuadrar saldo"). */
export const MOVEMENT_TYPES = [
  "expense",
  "income",
  "transfer",
] as const satisfies readonly MovementType[];

/**
 * The backend caps a description at 200 characters (`maxLength` in openapi.json, and a CHECK in the
 * database) after trimming it. Both count code points, so does the form.
 */
export const MOVEMENT_DESCRIPTION_MAX_LENGTH = 200;

const AMOUNT_REQUIRED = "Escribe un monto.";
const ACCOUNT_REQUIRED = "Elige una cuenta.";
const FROM_ACCOUNT_REQUIRED = "Elige la cuenta de origen.";
const TO_ACCOUNT_REQUIRED = "Elige la cuenta de destino.";
const CATEGORY_REQUIRED = "Elige una categoría.";
const DATE_REQUIRED = "Elige una fecha.";
const DESCRIPTION_TOO_LONG = `Usa como máximo ${MOVEMENT_DESCRIPTION_MAX_LENGTH} caracteres.`;
const TYPE_REQUIRED = "Elige un tipo de movimiento.";

/** What the form holds: all text, before the schema checks it. */
type FormFields = {
  type: MovementType;
  amount: string;
  accountId: string;
  toAccountId: string;
  categoryId: string;
  date: string;
  description: string;
};

type FormIssue = { path: keyof FormFields; message: string };

type BuildResult = { ok: true; body: MovementCreate } | { ok: false; issues: FormIssue[] };

function isMovementType(value: unknown): value is MovementType {
  return MOVEMENT_TYPES.some((type) => type === value);
}

/**
 * The body for the values of the form, or every problem found (by form field), so the person sees
 * all of them at once. `amount` is the schema of the amount of this space's currency.
 */
function buildMovementBody(
  values: FormFields,
  amount: ReturnType<typeof moneyAmountSchema>,
): BuildResult {
  const issues: FormIssue[] = [];
  const type: unknown = values.type;
  if (!isMovementType(type)) issues.push({ path: "type", message: TYPE_REQUIRED });

  const parsedAmount = amount.safeParse(values.amount);
  if (!parsedAmount.success) {
    issues.push({
      path: "amount",
      message: parsedAmount.error.issues[0]?.message ?? AMOUNT_REQUIRED,
    });
  }

  if (!isLocalDate(values.date)) issues.push({ path: "date", message: DATE_REQUIRED });

  // Trimmed first, as the backend does, and counted in code points (an emoji weighs 2 in `.length`).
  const description = values.description.trim();
  if ([...description].length > MOVEMENT_DESCRIPTION_MAX_LENGTH) {
    issues.push({ path: "description", message: DESCRIPTION_TOO_LONG });
  }

  if (type === "transfer") {
    if (values.accountId === "") issues.push({ path: "accountId", message: FROM_ACCOUNT_REQUIRED });
    if (values.toAccountId === "") {
      issues.push({ path: "toAccountId", message: TO_ACCOUNT_REQUIRED });
    } else if (values.toAccountId === values.accountId) {
      issues.push({ path: "toAccountId", message: fieldErrorMessage("transfer_same_account") });
    }
  } else if (type === "expense" || type === "income") {
    if (values.accountId === "") issues.push({ path: "accountId", message: ACCOUNT_REQUIRED });
    if (values.categoryId === "") issues.push({ path: "categoryId", message: CATEGORY_REQUIRED });
  }

  if (issues.length > 0 || !parsedAmount.success || !isMovementType(type)) {
    return { ok: false, issues };
  }

  // Nothing but a real description: the backend refuses an empty one (`min_length` 1), so it is left out.
  const common = {
    date: values.date,
    amount_minor: parsedAmount.data,
    ...(description === "" ? {} : { description }),
  };
  const body: MovementCreate =
    type === "transfer"
      ? {
          type,
          from_account_id: values.accountId,
          to_account_id: values.toAccountId,
          ...common,
        }
      : { type, account_id: values.accountId, category_id: values.categoryId, ...common };
  return { ok: true, body };
}

/**
 * `exponent` is the one of the space's currency (`SpaceRead.currency.exponent`): it decides how many
 * decimals the amount accepts and how it becomes an integer (an invalid one throws a `RangeError`
 * when the schema is built).
 *
 * - **Amount.** Greater than zero, at most `exponent` decimals, a safe integer: the same rules and
 *   texts as `moneyAmountSchema` (a leading minus or a zero is refused, the backend applies the sign).
 * - **Expense and income.** An account and a category are required (the category must be of the
 *   kind; the form only offers those, and the backend answers `transaction_category_kind_mismatch`
 *   otherwise). They send `account_id` and `category_id`.
 * - **Transfer.** "Desde" (`accountId`) and "Hacia" (`toAccountId`), different from each other;
 *   it sends `from_account_id` and `to_account_id` and **no category**.
 * - **Date.** A real day `YYYY-MM-DD` (what `<input type="date">` gives; an empty one is refused).
 * - **Description.** Optional. Trimmed, at most `MOVEMENT_DESCRIPTION_MAX_LENGTH` code points, and
 *   left out of the body if nothing remains.
 *
 * The cross-field checks are in a `.check()` and not in the `.transform()`: Zod does not run a
 * `transform` after a failure, and the person would see the errors one attempt at a time.
 */
export function movementFormSchema(exponent: number) {
  const amount = moneyAmountSchema(exponent);
  return z
    .object({
      type: z.enum(MOVEMENT_TYPES, { error: TYPE_REQUIRED }),
      amount: z.string({ error: AMOUNT_REQUIRED }),
      accountId: z.string(),
      toAccountId: z.string(),
      categoryId: z.string(),
      date: z.string({ error: DATE_REQUIRED }),
      description: z.string(),
    })
    .check((context) => {
      const result = buildMovementBody(context.value, amount);
      if (result.ok) return;
      for (const issue of result.issues) {
        context.issues.push({
          code: "custom",
          input: context.value,
          path: [issue.path],
          message: issue.message,
        });
      }
    })
    .transform((values, context): MovementCreate => {
      // Only reached when the check found nothing; the issues are pushed again if it ever is not.
      const result = buildMovementBody(values, amount);
      if (result.ok) return result.body;
      for (const issue of result.issues) {
        context.issues.push({
          code: "custom",
          input: values,
          path: [issue.path],
          message: issue.message,
        });
      }
      return z.NEVER;
    });
}

/** What the form holds: all text, before the schema checks it. */
export type MovementFormValues = z.input<ReturnType<typeof movementFormSchema>>;

// Contract check (frontend/CLAUDE.md > Formularios). The form's values are not the request body, so
// what must match the generated type is the schema's **output**. What really holds it is the type
// `MovementCreate` on `body` in `buildMovementBody` and on the return of the `.transform`: a field
// the backend does not have, or one of the wrong type, fails `npm run typecheck` there. This line is
// only a second net, in case someone drops those annotations and the output drifts.
const _check: MovementCreate = {} as z.output<ReturnType<typeof movementFormSchema>>;
void _check;

// The field of the form each field of the backend's body is shown on. Anything else a 422 names
// goes to the Alert: the person cannot fix it in a field.
const FORM_FIELD_OF_API_FIELD: Readonly<Record<string, keyof MovementFormValues>> = {
  type: "type",
  amount_minor: "amount",
  account_id: "accountId",
  from_account_id: "accountId",
  to_account_id: "toAccountId",
  category_id: "categoryId",
  date: "date",
  description: "description",
};

/**
 * The field of the form a 422 of `POST /spaces/{id}/transactions` points at, or `undefined` if it
 * is not one the person can fix in a field. `apiPath` is `ValidationIssue.path` (`validationIssuesOf`
 * of `lib/core/i18n.ts`, which only drops the leading `body`), and in this endpoint it still has the
 * type of the movement in front: the body is a union by `type`, so the location is
 * `["body", "<type>", "<field>"]` and the path `"expense.account_id"`. The type is dropped here;
 * a path without it works too. `from_account_id` is the same field as `account_id` ("Cuenta" or
 * "Desde"). A location that only names the union (`["body"]`, as `union_tag_invalid`) gives `undefined`.
 */
export function movementFormFieldOf(apiPath: string): keyof MovementFormValues | undefined {
  const [first = "", ...rest] = apiPath.split(".");
  const field = isMovementType(first) ? rest.join(".") : apiPath;
  return Object.hasOwn(FORM_FIELD_OF_API_FIELD, field) ? FORM_FIELD_OF_API_FIELD[field] : undefined;
}

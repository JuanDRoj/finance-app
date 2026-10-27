import type { components } from "@/lib/api/schema";
import { ApiError } from "./data/errors";

/**
 * The one place where values that come from the backend turn into Spanish text. The backend
 * sends English `detail` and a stable `code` (docs/arquitectura-backend.md §4): the screen never
 * shows `detail` or the raw code. A new backend code needs its translation here.
 */

type ErrorResponse = components["schemas"]["ErrorResponse"];
type ValidationErrorBody = components["schemas"]["HTTPValidationError"];

export type ErrorDescription = {
  /** Short: what happened. */
  title: string;
  /** What to do next, and that the data is safe when it applies. */
  message: string;
};

const SAFE = "Tus datos están a salvo.";

/** `code` of `ErrorResponse` (404, 409, 401, 403, 500) to text. Codes are never renamed. */
const ERROR_BY_CODE: Record<string, ErrorDescription> = {
  not_authenticated: {
    title: "Tu sesión no está activa",
    message: `Inicia sesión de nuevo para continuar. ${SAFE}`,
  },
  invalid_session: {
    title: "Tu sesión venció",
    message: `Inicia sesión de nuevo para continuar. ${SAFE}`,
  },
  invalid_id_token: {
    title: "No pudimos verificar tu cuenta",
    message: "Vuelve a iniciar sesión. Si sigue pasando, inténtalo en unos minutos.",
  },
  email_required: {
    title: "Tu cuenta no tiene un correo",
    message: "Necesitamos un correo para crear tu espacio. Entra con otra cuenta o con tu correo.",
  },
  recent_sign_in_required: {
    title: "Vuelve a iniciar sesión",
    message: `Por seguridad, necesitamos que inicies sesión de nuevo para continuar. ${SAFE}`,
  },
  origin_not_allowed: {
    title: "No pudimos completar la acción",
    message: `Recarga la página e inténtalo de nuevo. ${SAFE}`,
  },
  space_not_found: {
    title: "No encontramos ese espacio",
    message: "Puede que ya no exista o que no tengas acceso. Vuelve al inicio y elige otro.",
  },
  // `PATCH /spaces/{id}`: the currency can only change while the space has no movements (BE-17).
  space_has_transactions: {
    title: "Ya no puedes cambiar la moneda",
    message: `Tu espacio ya tiene movimientos y sus montos están guardados en la moneda actual. ${SAFE}`,
  },
  // `/spaces/{id}/accounts/{account_id}` (BE-16): an account that does not exist in the space.
  account_not_found: {
    title: "No encontramos esa cuenta",
    message:
      "Puede que ya no exista o que la hayas archivado desde otro dispositivo. Vuelve al inicio e inténtalo de nuevo.",
  },
  // `POST .../archive` (BE-16): the balance is not zero. The screen explains it with the amount, in
  // its own alert; this is the fallback text for anywhere that shows the error as it is.
  account_has_balance: {
    title: "Todavía no puedes archivar esta cuenta",
    message:
      "Para archivarla, su saldo tiene que ser cero. Cuádrala o pasa el dinero a otra cuenta.",
  },
  // `POST .../reconcile` (BE-16): an archived account cannot be reconciled.
  account_archived: {
    title: "Esa cuenta está archivada",
    message: "Desarchívala desde Cuentas para poder cuadrar su saldo.",
  },
  internal_error: {
    title: "Algo salió mal de nuestro lado",
    message: `Inténtalo de nuevo en unos minutos. ${SAFE}`,
  },
};

/** When the code is new or unknown: the HTTP status still says what kind of problem it is. */
function errorByStatus(status: number): ErrorDescription {
  if (status === 401) return ERROR_BY_CODE.invalid_session as ErrorDescription;
  if (status === 403) {
    return {
      title: "No tienes permiso para esto",
      message: "Si crees que es un error, vuelve al inicio e inténtalo de nuevo.",
    };
  }
  if (status === 404) {
    return {
      title: "No encontramos lo que buscabas",
      message: "Puede que ya no exista. Vuelve atrás e inténtalo de nuevo.",
    };
  }
  if (status === 409) {
    return {
      title: "Esto choca con el estado actual",
      message: "Recarga la página para ver lo último e inténtalo de nuevo.",
    };
  }
  if (status === 422) {
    return {
      title: "Revisa los datos",
      message: "Hay información que no podemos aceptar. Corrígela e inténtalo de nuevo.",
    };
  }
  if (status >= 500) return ERROR_BY_CODE.internal_error as ErrorDescription;
  return GENERIC_ERROR;
}

export const GENERIC_ERROR: ErrorDescription = {
  title: "No pudimos completar la acción",
  message: `Inténtalo de nuevo. ${SAFE}`,
};

export const NETWORK_ERROR: ErrorDescription = {
  title: "No pudimos conectar",
  message: `Revisa tu conexión e inténtalo de nuevo. ${SAFE}`,
};

/** `type` of a 422 validation error (Pydantic or a service) to a message for the field. */
const FIELD_ERROR_BY_TYPE: Record<string, string> = {
  missing: "Este campo es obligatorio.",
  string_too_short: "Es demasiado corto.",
  string_too_long: "Es demasiado largo.",
  string_type: "Escribe un texto.",
  int_parsing: "Escribe un número entero.",
  decimal_parsing: "Escribe un número válido.",
  greater_than: "El valor es demasiado bajo.",
  less_than: "El valor es demasiado alto.",
  less_than_equal: "El valor es demasiado alto.",
  value_error: "El valor no es válido.",
  // A field the form did not send, or sent when it should not: not something to fix in the field.
  extra_forbidden: "Hay un dato que no podemos aceptar.",
  // `POST /spaces/{id}/transactions` (BE-18): the account or the category of the movement.
  account_not_found: "Esa cuenta ya no existe. Elige otra.",
  account_archived: "Esa cuenta está archivada. Elige otra.",
  category_not_found: "Esa categoría ya no existe. Elige otra.",
  category_archived: "Esa categoría está archivada. Elige otra.",
  transaction_category_kind_mismatch: "Esa categoría no es de este tipo de movimiento. Elige otra.",
  transfer_same_account: "Elige dos cuentas distintas.",
  date_invalid: "Escribe una fecha válida.",
  union_tag_invalid: "Elige un tipo de movimiento.",
  // `POST /spaces/{id}/accounts` (BE-16): the closing and due days belong to credit cards only.
  card_day_required: "Elige un día del 1 al 31.",
  card_day_not_allowed: "Solo las tarjetas tienen día de cierre y de vencimiento.",
  // A `PATCH` that sends an explicit `null` for a field that cannot be cleared.
  null_not_allowed: "Este campo no puede quedar vacío.",
};

const FIELD_ERROR_FALLBACK = "El valor no es válido.";

/**
 * `type` of a 422 whose cause the user cannot fix by editing a field (the client sends it, not
 * a form field). It gets a complete description instead of "Corrígelo e inténtalo de nuevo".
 */
const VALIDATION_ERROR_BY_TYPE: Record<string, ErrorDescription> = {
  // `POST /auth/session`: the device's IANA zone, read with Intl, is not one the backend knows.
  timezone_invalid: {
    title: "No pudimos detectar tu zona horaria",
    message:
      "Revisa la configuración de fecha y hora de tu dispositivo e inténtalo de nuevo. Tus datos están a salvo.",
  },
  // `PATCH /spaces/{id}`: the code is not one of the seeded currencies. The user picks from the
  // list the backend sent, so this means the list is out of date, not that a field is wrong.
  currency_unsupported: {
    title: "Esa moneda no está disponible",
    message: `Elige otra de la lista. ${SAFE}`,
  },
};

/** Spanish message for the `type` of a 422 issue (to mark a form field). Never undefined. */
export function fieldErrorMessage(type: string): string {
  return Object.hasOwn(FIELD_ERROR_BY_TYPE, type)
    ? (FIELD_ERROR_BY_TYPE[type] ?? FIELD_ERROR_FALLBACK)
    : FIELD_ERROR_FALLBACK;
}

/** A problem of one field of a 422: where it is and what to tell the person. */
export type ValidationIssue = {
  /**
   * The field, as the backend names it, without the leading `body` (`["body", "closing_day"]` is
   * `"closing_day"`; a nested one is joined with dots). A form maps it to its own field.
   */
  path: string;
  /** Spanish text for the field (`fieldErrorMessage` of the issue's `type`). */
  message: string;
};

/**
 * The fields a 422 points at, in the order the backend lists them, ready for `setError`. Empty
 * for anything that is not an `ApiError` with FastAPI's 422 body (a 404, a network failure, a
 * body that is not that shape), so a form can tell "mark these fields" from "show an Alert".
 */
export function validationIssuesOf(error: unknown): ValidationIssue[] {
  if (!(error instanceof ApiError) || error.status !== 422) return [];
  if (!isValidationErrorBody(error.body)) return [];
  return (error.body.detail ?? []).map((issue) => {
    const loc = issue.loc[0] === "body" ? issue.loc.slice(1) : issue.loc;
    return { path: loc.join("."), message: fieldErrorMessage(issue.type) };
  });
}

/** Runtime check of the error body: `ApiError.body` is `unknown` until we look at it. */
export function isErrorResponse(body: unknown): body is ErrorResponse {
  if (typeof body !== "object" || body === null) return false;
  const { code, detail } = body as Record<string, unknown>;
  return typeof code === "string" && typeof detail === "string";
}

/** Runtime check of FastAPI's 422 body: `{ detail: [{ type, loc, msg }] }`. */
export function isValidationErrorBody(body: unknown): body is ValidationErrorBody {
  if (typeof body !== "object" || body === null) return false;
  const { detail } = body as Record<string, unknown>;
  return Array.isArray(detail);
}

/**
 * Turns whatever a failed request threw into Spanish text for an `Alert` or a toast.
 * Order: an `ApiError` with a known `code` > a 422 > the HTTP status > a network failure
 * (`fetch` rejects with a `TypeError`) > a generic message. Never returns the backend's
 * English `detail` or a raw code.
 */
export function describeApiError(error: unknown): ErrorDescription {
  if (error instanceof ApiError) {
    const { status, body } = error;
    if (status === 422 && isValidationErrorBody(body)) {
      const [first, ...rest] = body.detail ?? [];
      const base = errorByStatus(422);
      if (first && rest.length === 0) {
        // A problem the user cannot fix in a field has its own full text.
        if (Object.hasOwn(VALIDATION_ERROR_BY_TYPE, first.type)) {
          return VALIDATION_ERROR_BY_TYPE[first.type] ?? base;
        }
        // A single known problem can be said precisely; several go to the fields.
        if (Object.hasOwn(FIELD_ERROR_BY_TYPE, first.type)) {
          return {
            ...base,
            message: `${fieldErrorMessage(first.type)} Corrígelo e inténtalo de nuevo.`,
          };
        }
      }
      return base;
    }
    if (isErrorResponse(body)) {
      const known = Object.hasOwn(ERROR_BY_CODE, body.code) ? ERROR_BY_CODE[body.code] : undefined;
      if (known) return known;
    }
    return errorByStatus(status);
  }
  if (error instanceof TypeError) return NETWORK_ERROR;
  return GENERIC_ERROR;
}

/**
 * Names of the currencies a space can use, in Spanish. `GET /currencies` sends only the code and
 * the exponent, so the name lives here (docs/diseno.md D18). The order is the one of the list the
 * user picks from (FE-16): UYU, COP, USD, ARS, BRL, EUR.
 */
export const CURRENCY_NAMES: Readonly<Record<string, string>> = {
  UYU: "Peso uruguayo",
  COP: "Peso colombiano",
  USD: "Dólar estadounidense",
  ARS: "Peso argentino",
  BRL: "Real brasileño",
  EUR: "Euro",
};

/**
 * A currency as the sidebar shows it: "Peso uruguayo · UYU". A code with no name here (the backend
 * added a currency) shows as the code alone, never a raw object key.
 */
export function describeCurrency(code: string): string {
  const name = Object.hasOwn(CURRENCY_NAMES, code) ? CURRENCY_NAMES[code] : undefined;
  return name ? `${name} · ${code}` : code;
}

/** Names of the account types (`AccountCreate.type`) in Spanish: the one place that translates them. */
export const ACCOUNT_TYPE_NAMES: Readonly<Record<"bank" | "cash" | "credit_card", string>> = {
  bank: "Banco",
  cash: "Efectivo",
  credit_card: "Tarjeta",
};

/** An account type as the person reads it. One this map does not know shows as "Cuenta". */
export function describeAccountType(type: string): string {
  return Object.hasOwn(ACCOUNT_TYPE_NAMES, type)
    ? (ACCOUNT_TYPE_NAMES[type as keyof typeof ACCOUNT_TYPE_NAMES] ?? "Cuenta")
    : "Cuenta";
}

/**
 * Names of the kinds of movement (`TransactionRead.type`) in Spanish: the one place that translates
 * them. A person registers the first three; an adjustment only comes from "Cuadrar saldo" and is
 * shown, never chosen.
 */
export const TRANSACTION_TYPE_NAMES: Readonly<
  Record<components["schemas"]["TransactionRead"]["type"], string>
> = {
  expense: "Gasto",
  income: "Ingreso",
  transfer: "Transferencia",
  adjustment: "Ajuste",
};

/** A kind of movement as the person reads it. One this map does not know shows as "Movimiento". */
export function describeTransactionType(type: string): string {
  return Object.hasOwn(TRANSACTION_TYPE_NAMES, type)
    ? (TRANSACTION_TYPE_NAMES[type as keyof typeof TRANSACTION_TYPE_NAMES] ?? "Movimiento")
    : "Movimiento";
}

/**
 * The currencies of `GET /currencies` in the order the person picks from (the order of
 * `CURRENCY_NAMES`: UYU, COP, USD, ARS, BRL, EUR). One the map does not know (the backend seeded a
 * new currency) goes after them, in the order the backend sent. Returns a new array.
 */
export function orderCurrencies<T extends { code: string }>(currencies: readonly T[]): T[] {
  const known = Object.keys(CURRENCY_NAMES);
  const rank = (code: string) => {
    const index = known.indexOf(code);
    return index === -1 ? known.length : index;
  };
  return currencies
    .map((currency, position) => ({ currency, position }))
    .sort((a, b) => rank(a.currency.code) - rank(b.currency.code) || a.position - b.position)
    .map(({ currency }) => currency);
}

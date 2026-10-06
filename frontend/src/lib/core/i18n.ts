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
  value_error: "El valor no es válido.",
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
};

/** Spanish message for the `type` of a 422 issue (to mark a form field). Never undefined. */
export function fieldErrorMessage(type: string): string {
  return Object.hasOwn(FIELD_ERROR_BY_TYPE, type)
    ? (FIELD_ERROR_BY_TYPE[type] ?? FIELD_ERROR_FALLBACK)
    : FIELD_ERROR_FALLBACK;
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

import { describe, expect, it } from "vitest";
import { ApiError } from "./data/errors";
import {
  ACCOUNT_TYPE_NAMES,
  CURRENCY_NAMES,
  TRANSACTION_TYPE_NAMES,
  describeAccountType,
  describeApiError,
  describeCurrency,
  describeTransactionType,
  fieldErrorMessage,
  isErrorResponse,
  isValidationErrorBody,
  orderCurrencies,
  validationIssuesOf,
} from "./i18n";

// Codes the backend raises today (backend/app: NotFoundError, UnauthenticatedError, ForbiddenError
// and the 500 handler). A new backend code must be added here and to ERROR_BY_CODE.
const KNOWN_CODES = [
  "not_authenticated",
  "invalid_session",
  "invalid_id_token",
  "email_required",
  "recent_sign_in_required",
  "origin_not_allowed",
  "space_not_found",
  "space_has_transactions",
  "account_not_found",
  "account_has_balance",
  "account_archived",
  "internal_error",
] as const;

const ENGLISH_DETAIL = "Space not found";

function apiError(status: number, body: unknown): ApiError {
  return new ApiError(status, body);
}

describe("describeApiError", () => {
  it.each(KNOWN_CODES)("translates the backend code %s", (code) => {
    const result = describeApiError(apiError(401, { detail: ENGLISH_DETAIL, code }));
    expect(result.title).not.toBe("");
    // Not the generic fallback for an unknown code: each known code has its own text.
    expect(result).not.toEqual(describeApiError(apiError(418, undefined)));
  });

  it("never shows the English detail or the raw code", () => {
    for (const code of KNOWN_CODES) {
      const { title, message } = describeApiError(apiError(404, { detail: ENGLISH_DETAIL, code }));
      expect(`${title} ${message}`).not.toContain(ENGLISH_DETAIL);
      expect(`${title} ${message}`).not.toContain(code);
    }
  });

  it("falls back to the HTTP status for a code it does not know", () => {
    const unknownCode = { detail: "Whatever", code: "brand_new_code" };
    expect(describeApiError(apiError(404, unknownCode)).title).toBe(
      "No encontramos lo que buscabas",
    );
    expect(describeApiError(apiError(409, unknownCode)).title).toBe(
      "Esto choca con el estado actual",
    );
    expect(describeApiError(apiError(503, unknownCode))).toEqual(
      describeApiError(apiError(500, { detail: "x", code: "internal_error" })),
    );
  });

  it("does not trust inherited keys as codes", () => {
    const result = describeApiError(apiError(404, { detail: "x", code: "toString" }));
    expect(result.title).toBe("No encontramos lo que buscabas");
  });

  it("handles an error response without a body (a bare 404 or 502)", () => {
    expect(describeApiError(apiError(404, undefined)).title).toBe("No encontramos lo que buscabas");
    expect(describeApiError(apiError(502, undefined)).title).toBe("Algo salió mal de nuestro lado");
  });

  it("describes a 422 with one known problem precisely", () => {
    const body = { detail: [{ type: "missing", loc: ["body", "name"], msg: "Field required" }] };
    const result = describeApiError(apiError(422, body));
    expect(result.title).toBe("Revisa los datos");
    expect(result.message).toContain("Este campo es obligatorio.");
  });

  it("describes timezone_invalid (POST /auth/session) with a text the user can act on", () => {
    const body = {
      detail: [
        { type: "timezone_invalid", loc: ["body", "timezone"], msg: "Invalid IANA timezone" },
      ],
    };
    const { title, message } = describeApiError(apiError(422, body));
    expect(title).toBe("No pudimos detectar tu zona horaria");
    expect(message).toContain("fecha y hora");
    // Not the generic "fix the data" text: the user cannot edit this value.
    expect(message).not.toContain("Corrígelo");
    expect(`${title} ${message}`).not.toContain("timezone");
    expect(`${title} ${message}`).not.toContain("Invalid IANA timezone");
  });

  it("describes a 422 with several problems in general terms", () => {
    const body = {
      detail: [
        { type: "missing", loc: ["body", "name"], msg: "Field required" },
        { type: "string_too_long", loc: ["body", "note"], msg: "Too long" },
      ],
    };
    const result = describeApiError(apiError(422, body));
    expect(result.title).toBe("Revisa los datos");
    expect(result.message).not.toContain("obligatorio");
  });

  it("describes a network failure (fetch rejects with a TypeError)", () => {
    expect(describeApiError(new TypeError("Failed to fetch")).title).toBe("No pudimos conectar");
  });

  it("describes anything else with a generic message", () => {
    expect(describeApiError("boom").title).toBe("No pudimos completar la acción");
    expect(describeApiError(undefined).title).toBe("No pudimos completar la acción");
  });

  it("says that the data is safe where something may have gone wrong", () => {
    expect(
      describeApiError(apiError(500, { detail: "x", code: "internal_error" })).message,
    ).toContain("a salvo");
  });
});

describe("codes of the accounts and the currency (KAN-91)", () => {
  const generic = describeApiError(apiError(418, undefined));

  it("translates the 409 of a locked currency with its own text", () => {
    const result = describeApiError(
      apiError(409, {
        detail: "The currency cannot be changed once the space has transactions",
        code: "space_has_transactions",
      }),
    );
    expect(result.title).toBe("Ya no puedes cambiar la moneda");
    expect(result.message).toContain("movimientos");
    expect(result.message).toContain("a salvo");
    // Not the generic 409 ("Esto choca con el estado actual") nor the generic fallback.
    expect(result).not.toEqual(describeApiError(apiError(409, undefined)));
    expect(result).not.toEqual(generic);
  });

  it("translates the 404 of an account that does not exist", () => {
    const result = describeApiError(
      apiError(404, { detail: "Account not found", code: "account_not_found" }),
    );
    expect(result.title).toBe("No encontramos esa cuenta");
    expect(result).not.toEqual(describeApiError(apiError(404, undefined)));
    expect(`${result.title} ${result.message}`).not.toContain("account_not_found");
    expect(`${result.title} ${result.message}`).not.toContain("Account not found");
  });

  it.each([
    ["card_day_required", "Elige un día del 1 al 31."],
    ["card_day_not_allowed", "Solo las tarjetas tienen día de cierre y de vencimiento."],
    ["null_not_allowed", "Este campo no puede quedar vacío."],
  ])("marks a field with the 422 type %s in Spanish", (type, text) => {
    expect(fieldErrorMessage(type)).toBe(text);
    expect(fieldErrorMessage(type)).not.toBe(fieldErrorMessage("some_future_type"));
    expect(fieldErrorMessage(type)).not.toContain(type);
  });

  it.each(["card_day_required", "card_day_not_allowed", "null_not_allowed"])(
    "says %s precisely when it is the only problem, never as the generic text",
    (type) => {
      const body = { detail: [{ type, loc: ["body", "closing_day"], msg: "English msg" }] };
      const { title, message } = describeApiError(apiError(422, body));
      expect(title).toBe("Revisa los datos");
      expect(message).toContain(fieldErrorMessage(type));
      expect(message).not.toBe(describeApiError(apiError(422, undefined)).message);
      expect(`${title} ${message}`).not.toContain(type);
      expect(`${title} ${message}`).not.toContain("English msg");
    },
  );

  it("describes currency_unsupported as a whole, not as a field to fix", () => {
    const body = {
      detail: [{ type: "currency_unsupported", loc: ["body", "currency"], msg: "Unsupported" }],
    };
    const { title, message } = describeApiError(apiError(422, body));
    expect(title).toBe("Esa moneda no está disponible");
    expect(message).toContain("a salvo");
    expect(message).not.toContain("Corrígelo");
    expect(`${title} ${message}`).not.toContain("currency_unsupported");
  });
});

describe("codes of the movements (KAN-74, KAN-94)", () => {
  // The 422 `type`s of `POST /spaces/{id}/transactions` (backend/app/modules/transactions) and the
  // Pydantic ones its body can raise, each with the text under the field.
  const TYPES: readonly (readonly [string, string])[] = [
    ["account_not_found", "Esa cuenta ya no existe. Elige otra."],
    ["account_archived", "Esa cuenta está archivada. Elige otra."],
    ["category_not_found", "Esa categoría ya no existe. Elige otra."],
    ["category_archived", "Esa categoría está archivada. Elige otra."],
    [
      "transaction_category_kind_mismatch",
      "Esa categoría no es de este tipo de movimiento. Elige otra.",
    ],
    ["transfer_same_account", "Elige dos cuentas distintas."],
    ["date_invalid", "Escribe una fecha válida."],
    ["union_tag_invalid", "Elige un tipo de movimiento."],
    ["less_than_equal", "El valor es demasiado alto."],
    ["extra_forbidden", "Hay un dato que no podemos aceptar."],
  ];

  it.each(TYPES)("marks a field with the 422 type %s in Spanish", (type, text) => {
    expect(fieldErrorMessage(type)).toBe(text);
    expect(fieldErrorMessage(type)).not.toBe(fieldErrorMessage("some_future_type"));
    expect(fieldErrorMessage(type)).not.toContain(type);
  });

  it("keeps the types the movements share with other forms as they were", () => {
    expect(fieldErrorMessage("missing")).toBe("Este campo es obligatorio.");
    expect(fieldErrorMessage("greater_than")).toBe("El valor es demasiado bajo.");
    expect(fieldErrorMessage("string_too_long")).toBe("Es demasiado largo.");
  });

  it("lists the fields of a 422 of a movement with the type still in the location", () => {
    // The union puts the `type` of the movement between `body` and the field: the form strips it
    // (`movementFormFieldOf`); `validationIssuesOf` only drops `body`.
    const body = {
      detail: [
        { type: "account_archived", loc: ["body", "expense", "account_id"], msg: "English" },
        {
          type: "transaction_category_kind_mismatch",
          loc: ["body", "expense", "category_id"],
          msg: "English",
        },
      ],
    };
    expect(validationIssuesOf(apiError(422, body))).toEqual([
      { path: "expense.account_id", message: "Esa cuenta está archivada. Elige otra." },
      {
        path: "expense.category_id",
        message: "Esa categoría no es de este tipo de movimiento. Elige otra.",
      },
    ]);
  });

  it("does not turn the 409 code account_archived (reconcile) into the text of the field", () => {
    const { title, message } = describeApiError(
      apiError(409, { detail: "The account is archived", code: "account_archived" }),
    );
    expect(title).toBe("Esa cuenta está archivada");
    expect(message).toContain("Desarchívala desde Cuentas");
  });

  it("says a single 422 problem precisely, in Spanish and without the raw type", () => {
    const body = {
      detail: [
        {
          type: "transfer_same_account",
          loc: ["body", "transfer", "to_account_id"],
          msg: "English",
        },
      ],
    };
    const { title, message } = describeApiError(apiError(422, body));
    expect(title).toBe("Revisa los datos");
    expect(message).toContain("Elige dos cuentas distintas.");
    expect(`${title} ${message}`).not.toContain("transfer_same_account");
    expect(`${title} ${message}`).not.toContain("English");
  });
});

describe("describeTransactionType", () => {
  it("names the four kinds of movement in Spanish", () => {
    expect(describeTransactionType("expense")).toBe("Gasto");
    expect(describeTransactionType("income")).toBe("Ingreso");
    expect(describeTransactionType("transfer")).toBe("Transferencia");
    expect(describeTransactionType("adjustment")).toBe("Ajuste");
    expect(Object.keys(TRANSACTION_TYPE_NAMES)).toEqual([
      "expense",
      "income",
      "transfer",
      "adjustment",
    ]);
  });

  it("never shows the raw value nor reads inherited keys", () => {
    for (const type of ["refund", "constructor", "toString", "__proto__", ""]) {
      expect(describeTransactionType(type)).toBe("Movimiento");
    }
  });
});

describe("validationIssuesOf", () => {
  it("lists the fields of a 422 without the leading `body`, in Spanish", () => {
    const body = {
      detail: [
        {
          type: "card_day_required",
          loc: ["body", "closing_day"],
          msg: "A credit card needs this day",
        },
        {
          type: "card_day_required",
          loc: ["body", "due_day"],
          msg: "A credit card needs this day",
        },
        { type: "string_too_long", loc: ["body", "name"], msg: "Too long" },
      ],
    };
    expect(validationIssuesOf(apiError(422, body))).toEqual([
      { path: "closing_day", message: "Elige un día del 1 al 31." },
      { path: "due_day", message: "Elige un día del 1 al 31." },
      { path: "name", message: "Es demasiado largo." },
    ]);
  });

  it("joins a nested location with dots and keeps a non-body location whole", () => {
    const body = {
      detail: [
        { type: "missing", loc: ["body", "items", 0, "name"], msg: "x" },
        { type: "int_parsing", loc: ["path", "space_id"], msg: "x" },
      ],
    };
    expect(validationIssuesOf(apiError(422, body))).toEqual([
      { path: "items.0.name", message: "Este campo es obligatorio." },
      { path: "path.space_id", message: "Escribe un número entero." },
    ]);
  });

  it("falls back to the generic field text for a type it does not know, never the raw type", () => {
    const body = { detail: [{ type: "brand_new_type", loc: ["body", "name"], msg: "x" }] };
    expect(validationIssuesOf(apiError(422, body))).toEqual([
      { path: "name", message: "El valor no es válido." },
    ]);
  });

  it("is empty for anything that is not a 422 with FastAPI's body", () => {
    expect(validationIssuesOf(apiError(404, { detail: "x", code: "account_not_found" }))).toEqual(
      [],
    );
    expect(validationIssuesOf(apiError(422, undefined))).toEqual([]);
    expect(validationIssuesOf(apiError(422, { detail: "not a list" }))).toEqual([]);
    expect(validationIssuesOf(apiError(422, { detail: [] }))).toEqual([]);
    expect(validationIssuesOf(new TypeError("Failed to fetch"))).toEqual([]);
    expect(validationIssuesOf("boom")).toEqual([]);
    expect(validationIssuesOf(undefined)).toEqual([]);
  });
});

describe("describeAccountType", () => {
  it("names the three types in Spanish", () => {
    expect(describeAccountType("bank")).toBe("Banco");
    expect(describeAccountType("cash")).toBe("Efectivo");
    expect(describeAccountType("credit_card")).toBe("Tarjeta");
    expect(Object.keys(ACCOUNT_TYPE_NAMES)).toEqual(["bank", "cash", "credit_card"]);
  });

  it("never shows the raw value nor reads inherited keys", () => {
    for (const type of ["savings", "constructor", "toString", "__proto__", ""]) {
      expect(describeAccountType(type)).toBe("Cuenta");
    }
  });
});

describe("fieldErrorMessage", () => {
  it("translates known validation types and never returns the raw type", () => {
    expect(fieldErrorMessage("missing")).toBe("Este campo es obligatorio.");
    expect(fieldErrorMessage("some_future_type")).toBe("El valor no es válido.");
    expect(fieldErrorMessage("constructor")).toBe("El valor no es válido.");
  });
});

describe("body guards", () => {
  it("recognizes ErrorResponse and the 422 body", () => {
    expect(isErrorResponse({ detail: "x", code: "y" })).toBe(true);
    expect(isErrorResponse({ detail: [], code: "y" })).toBe(false);
    expect(isErrorResponse(undefined)).toBe(false);
    expect(isErrorResponse(null)).toBe(false);
    expect(isValidationErrorBody({ detail: [] })).toBe(true);
    expect(isValidationErrorBody({ detail: "x" })).toBe(false);
  });
});

describe("describeCurrency", () => {
  it("names the currency in Spanish, with its code", () => {
    expect(describeCurrency("UYU")).toBe("Peso uruguayo · UYU");
    expect(describeCurrency("USD")).toBe("Dólar estadounidense · USD");
    expect(describeCurrency("EUR")).toBe("Euro · EUR");
  });

  it("shows only the code when it has no name, and never reads inherited keys", () => {
    expect(describeCurrency("XYZ")).toBe("XYZ");
    expect(describeCurrency("constructor")).toBe("constructor");
  });

  it("keeps the order of the list the user picks from (docs/diseno.md D18)", () => {
    expect(Object.keys(CURRENCY_NAMES)).toEqual(["UYU", "COP", "USD", "ARS", "BRL", "EUR"]);
  });
});

describe("orderCurrencies", () => {
  const codes = (list: { code: string }[]) => list.map((currency) => currency.code);

  it("puts the currencies in the order of the list the person picks from", () => {
    const fromBackend = ["EUR", "ARS", "UYU", "BRL", "USD", "COP"].map((code) => ({ code }));
    expect(codes(orderCurrencies(fromBackend))).toEqual(["UYU", "COP", "USD", "ARS", "BRL", "EUR"]);
  });

  it("keeps the rest of each currency untouched", () => {
    const list = [
      { code: "USD", exponent: 2 },
      { code: "UYU", exponent: 2 },
    ];
    expect(orderCurrencies(list)).toEqual([
      { code: "UYU", exponent: 2 },
      { code: "USD", exponent: 2 },
    ]);
  });

  it("sends a currency without a name after the known ones, in the order the backend gave", () => {
    const fromBackend = ["CLP", "EUR", "PEN", "UYU"].map((code) => ({ code }));
    expect(codes(orderCurrencies(fromBackend))).toEqual(["UYU", "EUR", "CLP", "PEN"]);
  });

  it("does not change the array it is given, and copes with an empty one", () => {
    const list = [{ code: "EUR" }, { code: "UYU" }];
    orderCurrencies(list);
    expect(codes(list)).toEqual(["EUR", "UYU"]);
    expect(orderCurrencies([])).toEqual([]);
  });

  it("does not take inherited keys for known currencies", () => {
    expect(codes(orderCurrencies([{ code: "constructor" }, { code: "UYU" }]))).toEqual([
      "UYU",
      "constructor",
    ]);
  });
});

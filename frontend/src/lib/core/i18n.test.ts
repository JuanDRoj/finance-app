import { describe, expect, it } from "vitest";
import { ApiError } from "./data/errors";
import {
  describeApiError,
  fieldErrorMessage,
  isErrorResponse,
  isValidationErrorBody,
} from "./i18n";

// Codes the backend raises today (backend/app: NotFoundError, UnauthenticatedError, ForbiddenError
// and the 500 handler). A new backend code must be added here and to ERROR_BY_CODE.
const KNOWN_CODES = [
  "not_authenticated",
  "invalid_session",
  "invalid_id_token",
  "origin_not_allowed",
  "space_not_found",
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

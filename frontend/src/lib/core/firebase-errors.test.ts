import { FirebaseError } from "firebase/app";
import { describe, expect, it } from "vitest";
import { ApiError } from "./data/errors";
import {
  describeFirebaseAuthError,
  describeLoginError,
  isFirebaseAuthError,
  isSignInCancelled,
} from "./firebase-errors";
import { describeApiError, GENERIC_ERROR } from "./i18n";

// A FirebaseError the way the SDK raises it: `code` plus an English `message` that must never
// reach the screen.
const ENGLISH_MESSAGE = "Firebase: Error (auth/some-code).";

function firebaseError(code: string): FirebaseError {
  return new FirebaseError(code, ENGLISH_MESSAGE);
}

// Every Firebase Auth code the login can hit that has its own text.
const TRANSLATED_CODES = [
  "auth/invalid-credential",
  "auth/invalid-login-credentials",
  "auth/wrong-password",
  "auth/user-not-found",
  "auth/invalid-email",
  "auth/user-disabled",
  "auth/too-many-requests",
  "auth/email-already-in-use",
  "auth/weak-password",
  "auth/operation-not-allowed",
  "auth/account-exists-with-different-credential",
  "auth/popup-blocked",
  "auth/network-request-failed",
  "auth/unauthorized-domain",
  "auth/operation-not-supported-in-this-environment",
  "auth/web-storage-unsupported",
  "auth/internal-error",
] as const;

describe("describeFirebaseAuthError", () => {
  it.each(TRANSLATED_CODES)("translates %s into Spanish", (code) => {
    const { title, message } = describeFirebaseAuthError(firebaseError(code));
    expect(title).not.toBe("");
    expect(message).not.toBe("");
    // Own text, not the generic fallback.
    expect({ title, message }).not.toEqual(GENERIC_ERROR);
  });

  it.each(TRANSLATED_CODES)("never shows the code or Firebase's English text for %s", (code) => {
    const { title, message } = describeFirebaseAuthError(firebaseError(code));
    const text = `${title} ${message}`;
    expect(text).not.toContain("auth/");
    expect(text).not.toContain(code.replace("auth/", ""));
    expect(text).not.toContain("Firebase");
    expect(text).not.toContain(ENGLISH_MESSAGE);
  });

  it("says the same for every wrong-credential cause, so it does not reveal who has an account", () => {
    const wrong = describeFirebaseAuthError(firebaseError("auth/wrong-password"));
    expect(describeFirebaseAuthError(firebaseError("auth/user-not-found"))).toEqual(wrong);
    expect(describeFirebaseAuthError(firebaseError("auth/invalid-credential"))).toEqual(wrong);
    expect(describeFirebaseAuthError(firebaseError("auth/invalid-login-credentials"))).toEqual(
      wrong,
    );
    expect(wrong.title).toBe("Correo o contraseña incorrectos");
  });

  it("tells the user what to do when the email is already taken", () => {
    const { title, message } = describeFirebaseAuthError(
      firebaseError("auth/email-already-in-use"),
    );
    expect(title).toBe("Ya existe una cuenta con ese correo");
    expect(message).toContain("Inicia sesión");
  });

  it("falls back to the generic message for a code it does not know", () => {
    expect(describeFirebaseAuthError(firebaseError("auth/brand-new-code"))).toEqual(GENERIC_ERROR);
  });

  it("does not trust inherited keys as codes", () => {
    expect(describeFirebaseAuthError({ code: "auth/toString" })).toEqual(GENERIC_ERROR);
    expect(describeFirebaseAuthError({ code: "auth/constructor" })).toEqual(GENERIC_ERROR);
  });

  it("falls back to the generic message for anything that is not a Firebase Auth error", () => {
    expect(describeFirebaseAuthError(undefined)).toEqual(GENERIC_ERROR);
    expect(describeFirebaseAuthError("boom")).toEqual(GENERIC_ERROR);
    expect(describeFirebaseAuthError({ code: 42 })).toEqual(GENERIC_ERROR);
  });

  it("says that the data is safe where something may have gone wrong", () => {
    expect(
      describeFirebaseAuthError(firebaseError("auth/network-request-failed")).message,
    ).toContain("a salvo");
    expect(describeFirebaseAuthError(firebaseError("auth/too-many-requests")).message).toContain(
      "a salvo",
    );
  });
});

describe("isFirebaseAuthError", () => {
  it("recognizes a FirebaseError from Firebase Auth by its code", () => {
    expect(isFirebaseAuthError(firebaseError("auth/invalid-credential"))).toBe(true);
    expect(isFirebaseAuthError({ code: "auth/popup-blocked" })).toBe(true);
  });

  it("rejects errors from elsewhere", () => {
    expect(isFirebaseAuthError(firebaseError("storage/unauthorized"))).toBe(false);
    expect(isFirebaseAuthError(new ApiError(401, { detail: "x", code: "invalid_id_token" }))).toBe(
      false,
    );
    expect(isFirebaseAuthError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isFirebaseAuthError({ code: 42 })).toBe(false);
    expect(isFirebaseAuthError(null)).toBe(false);
    expect(isFirebaseAuthError(undefined)).toBe(false);
  });
});

describe("isSignInCancelled", () => {
  it("is true when the user closes the Google popup or opens a second one", () => {
    expect(isSignInCancelled(firebaseError("auth/popup-closed-by-user"))).toBe(true);
    expect(isSignInCancelled(firebaseError("auth/cancelled-popup-request"))).toBe(true);
  });

  it("is false for a blocked popup and for any real failure", () => {
    expect(isSignInCancelled(firebaseError("auth/popup-blocked"))).toBe(false);
    expect(isSignInCancelled(firebaseError("auth/invalid-credential"))).toBe(false);
    expect(isSignInCancelled(new ApiError(500, undefined))).toBe(false);
    expect(isSignInCancelled(undefined)).toBe(false);
  });
});

describe("describeLoginError", () => {
  it("describes a Firebase error with the Firebase map", () => {
    const error = firebaseError("auth/weak-password");
    expect(describeLoginError(error)).toEqual(describeFirebaseAuthError(error));
  });

  it("describes the backend's answer to POST /auth/session with the API map", () => {
    const error = new ApiError(401, { detail: "Sign in again", code: "recent_sign_in_required" });
    expect(describeLoginError(error)).toEqual(describeApiError(error));
    expect(describeLoginError(error).title).toBe("Vuelve a iniciar sesión");
  });

  it("describes a network failure of the exchange (fetch rejects with a TypeError)", () => {
    expect(describeLoginError(new TypeError("Failed to fetch")).title).toBe("No pudimos conectar");
  });

  it("describes the timezone problem of the exchange without asking to fix a field", () => {
    const body = {
      detail: [
        { type: "timezone_invalid", loc: ["body", "timezone"], msg: "Invalid IANA timezone" },
      ],
    };
    const { title, message } = describeLoginError(new ApiError(422, body));
    expect(title).toBe("No pudimos detectar tu zona horaria");
    expect(message).not.toContain("Corrígelo");
  });
});

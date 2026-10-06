import { describe, expect, it } from "vitest";
import { loginSchema, PASSWORD_MIN_LENGTH, signUpSchema } from "./auth";

/** The message of the first issue of a field, or undefined when the field is valid. */
function fieldMessage(
  result: ReturnType<typeof loginSchema.safeParse>,
  field: "email" | "password",
): string | undefined {
  if (result.success) return undefined;
  return result.error.issues.find((issue) => issue.path[0] === field)?.message;
}

describe("loginSchema", () => {
  it("accepts an email and any non-empty password", () => {
    // Older accounts may have a password shorter than the minimum for new ones.
    const result = loginSchema.safeParse({ email: "ana@correo.com", password: "123456" });
    expect(result.success).toBe(true);
  });

  it("trims the email", () => {
    const result = loginSchema.safeParse({ email: "  ana@correo.com ", password: "x" });
    expect(result.success && result.data.email).toBe("ana@correo.com");
  });

  it("asks for the email when it is empty or only spaces", () => {
    expect(fieldMessage(loginSchema.safeParse({ email: "", password: "x" }), "email")).toBe(
      "Escribe tu correo.",
    );
    expect(fieldMessage(loginSchema.safeParse({ email: "   ", password: "x" }), "email")).toBe(
      "Escribe tu correo.",
    );
  });

  it("rejects an email that is not an email", () => {
    for (const email of ["ana", "ana@", "ana@correo", "@correo.com", "ana correo@x.com"]) {
      const message = fieldMessage(loginSchema.safeParse({ email, password: "x" }), "email");
      expect(message, email).toBe("Escribe un correo válido, por ejemplo nombre@correo.com.");
    }
  });

  it("asks for the password when it is empty", () => {
    expect(
      fieldMessage(loginSchema.safeParse({ email: "ana@correo.com", password: "" }), "password"),
    ).toBe("Escribe tu contraseña.");
  });

  it("reports both fields at once", () => {
    const result = loginSchema.safeParse({ email: "", password: "" });
    expect(fieldMessage(result, "email")).toBe("Escribe tu correo.");
    expect(fieldMessage(result, "password")).toBe("Escribe tu contraseña.");
  });
});

describe("signUpSchema", () => {
  it("accepts a password with the minimum length", () => {
    const password = "a".repeat(PASSWORD_MIN_LENGTH);
    expect(signUpSchema.safeParse({ email: "ana@correo.com", password }).success).toBe(true);
  });

  it("asks for at least 8 characters, in Spanish", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    const password = "a".repeat(PASSWORD_MIN_LENGTH - 1);
    expect(
      fieldMessage(signUpSchema.safeParse({ email: "ana@correo.com", password }), "password"),
    ).toBe("Usa al menos 8 caracteres.");
    expect(
      fieldMessage(signUpSchema.safeParse({ email: "ana@correo.com", password: "" }), "password"),
    ).toBe("Usa al menos 8 caracteres.");
  });

  it("does not trim the password (spaces are part of it)", () => {
    const result = signUpSchema.safeParse({ email: "ana@correo.com", password: "  abcdef  " });
    expect(result.success && result.data.password).toBe("  abcdef  ");
  });

  it("validates the email like the login does", () => {
    expect(
      fieldMessage(signUpSchema.safeParse({ email: "ana", password: "12345678" }), "email"),
    ).toBe("Escribe un correo válido, por ejemplo nombre@correo.com.");
  });
});

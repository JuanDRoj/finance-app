import { z } from "zod";

/**
 * Schemas of the login form. They only validate what the person typed before it goes to
 * Firebase Auth; the request to our own API (`POST /auth/session`, `{ id_token, timezone }`) is
 * typed by the generated client, so no contract check against it applies here.
 *
 * Messages are the Spanish text shown under each field.
 */

/**
 * Matches the Firebase password policy of the staging project (required, minimum 8): the form
 * rejects what Firebase would. Keep them in sync, and the text of
 * `auth/password-does-not-meet-requirements` in lib/core/firebase-errors.ts.
 */
export const PASSWORD_MIN_LENGTH = 8;

const EMAIL_REQUIRED = "Escribe tu correo.";

// Trimmed first (a phone keyboard often adds a trailing space); the format check only runs when
// something was typed, so an empty field says "Escribe tu correo." and not "no es válido".
const email = z
  .string({ error: EMAIL_REQUIRED })
  .trim()
  .min(1, EMAIL_REQUIRED)
  .pipe(z.email("Escribe un correo válido, por ejemplo nombre@correo.com."));

/** Signing in: any non-empty password goes to Firebase (older accounts may have a short one). */
export const loginSchema = z.object({
  email,
  password: z.string({ error: "Escribe tu contraseña." }).min(1, "Escribe tu contraseña."),
});

/** Creating an account: the password must be at least `PASSWORD_MIN_LENGTH` characters long. */
export const signUpSchema = z.object({
  email,
  password: z
    .string({ error: `Usa al menos ${PASSWORD_MIN_LENGTH} caracteres.` })
    .min(PASSWORD_MIN_LENGTH, `Usa al menos ${PASSWORD_MIN_LENGTH} caracteres.`),
});

/** What the form holds (before the schema trims the email); the same shape in both modes. */
export type LoginFormValues = z.input<typeof loginSchema>;

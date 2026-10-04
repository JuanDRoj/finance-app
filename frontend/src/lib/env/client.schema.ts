import { z } from "zod";

const required = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .trim()
    .min(1, `${name} is required`);

/**
 * Public variables (NEXT_PUBLIC_*): they are inlined into the browser bundle at build time, so
 * they must never hold secrets. Pure schema, safe to import from client code.
 */
export const clientSchema = z.object({
  NEXT_PUBLIC_FIREBASE_API_KEY: required("NEXT_PUBLIC_FIREBASE_API_KEY"),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: required("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: required("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
  // Local only (Firebase Auth emulator). Unset or empty means "use real Firebase".
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: z
    .string()
    .trim()
    .transform((value) => (value === "" ? undefined : value))
    .pipe(
      z
        .string()
        .regex(
          /^[^\s:/]+:\d+$/,
          "NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST must look like host:port, e.g. localhost:9099",
        )
        .optional(),
    )
    .optional(),
});

export type ClientEnv = z.output<typeof clientSchema>;

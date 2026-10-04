import { z } from "zod";
import { clientSchema } from "./client.schema";

// Each variable must be a literal `process.env.NEXT_PUBLIC_*` reference: Next.js only inlines
// those at build time. Passing `process.env` as a whole (or a dynamic key) yields `{}` in the
// browser.
const result = clientSchema.safeParse({
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST,
});

if (!result.success) {
  throw new Error(`Invalid client environment variables:\n${z.prettifyError(result.error)}`);
}

export const clientEnv = result.data;

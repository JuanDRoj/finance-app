import type { z } from "zod";
import { clientSchema } from "./client.schema";
import { serverSchema } from "./server.schema";

type Env = Record<string, string | undefined>;

function issuesOf(schema: z.ZodType, env: Env): string[] {
  const result = schema.safeParse(env);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

/**
 * Build/startup check, called from next.config.ts (so it runs for `next dev` and `next build`).
 * Server and client variables are validated together so every problem shows up in a single run.
 * Runs in plain Node: it must not import `server-only` or anything that needs the Next.js bundler.
 */
export function assertValidEnv(env: Env = process.env): void {
  const problems = [...issuesOf(serverSchema, env), ...issuesOf(clientSchema, env)];

  // Same rule as the backend: the Firebase emulator exists only locally. VERCEL_ENV is set by
  // Vercel (production | preview | development) and is absent on a developer machine.
  if (env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST?.trim() && env.VERCEL_ENV) {
    problems.push(
      `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST must not be set on Vercel (VERCEL_ENV=${env.VERCEL_ENV}); it is for local development only`,
    );
  }

  if (problems.length > 0) {
    const list = problems.map((problem) => `  - ${problem}`).join("\n");
    throw new Error(
      `Invalid environment variables:\n${list}\nCopy frontend/.env.example to frontend/.env.local and fill it in.`,
    );
  }
}

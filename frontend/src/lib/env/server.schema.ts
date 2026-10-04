import { z } from "zod";

/**
 * Server-only variables. Pure schema: no process.env access and no `server-only` import, so
 * next.config.ts (plain Node) can load it. Never import this file from client code.
 */
export const serverSchema = z.object({
  // FastAPI base URL, e.g. http://localhost:8000. Trailing slashes are dropped so that
  // `${BACKEND_URL}/path` never produces a double slash.
  BACKEND_URL: z
    .string({ error: "BACKEND_URL is required" })
    .trim()
    .min(1, "BACKEND_URL is required")
    .pipe(
      z.url({
        protocol: /^https?$/,
        error: "BACKEND_URL must be an http(s) URL, e.g. http://localhost:8000",
      }),
    )
    .transform((url) => url.replace(/\/+$/, "")),
});

export type ServerEnv = z.output<typeof serverSchema>;

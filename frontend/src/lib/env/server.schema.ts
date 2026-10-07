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
  // Name of the session cookie the backend sets (`Settings.session_cookie_name`): `session` when
  // the backend runs with ENV=local, `__Host-session` everywhere else. Required on purpose: a
  // silent default would drop the cookie in staging and bounce every user back to /login.
  SESSION_COOKIE_NAME: z
    .string({ error: "SESSION_COOKIE_NAME is required" })
    .trim()
    .min(1, "SESSION_COOKIE_NAME is required")
    .pipe(
      z.enum(["session", "__Host-session"], {
        error:
          'SESSION_COOKIE_NAME must be "session" (local backend) or "__Host-session" (staging and production), the name the backend uses',
      }),
    ),
});

export type ServerEnv = z.output<typeof serverSchema>;

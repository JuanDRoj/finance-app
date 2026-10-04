import "server-only";
import { z } from "zod";
import { serverSchema } from "./server.schema";

// Imported only from Server Components, route handlers and the proxy. Importing it from a
// Client Component is a build error (`server-only`). The build already validated these
// variables (see validate.ts), but BACKEND_URL is read at runtime, so check again here.
const result = serverSchema.safeParse(process.env);

if (!result.success) {
  throw new Error(`Invalid server environment variables:\n${z.prettifyError(result.error)}`);
}

export const serverEnv = result.data;

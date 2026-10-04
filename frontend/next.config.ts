import type { NextConfig } from "next";
// Relative import on purpose: next.config.ts does not resolve the `@/` alias.
import { assertValidEnv } from "./src/lib/env/validate";

// Fails `next dev` and `next build` with a clear message when an environment variable is missing.
assertValidEnv();

const nextConfig: NextConfig = {};

export default nextConfig;

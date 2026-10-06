import type { NextConfig } from "next";
// Relative imports on purpose: next.config.ts does not resolve the `@/` alias.
import { serverSchema } from "./src/lib/env/server.schema";
import { assertValidEnv } from "./src/lib/env/validate";

// Fails `next dev` and `next build` with a clear message when an environment variable is missing.
assertValidEnv();

// The pure schema (not `serverEnv`, which imports `server-only`) so plain Node can load it.
// BACKEND_URL is already validated above and has no trailing slash.
const { BACKEND_URL } = serverSchema.parse(process.env);

const nextConfig: NextConfig = {
  experimental: {
    // Loads only the icons that are used (Phosphor ships thousands). Not in Next's default list.
    optimizePackageImports: ["@phosphor-icons/react", "@phosphor-icons/react/ssr"],
  },
  async rewrites() {
    // The browser talks to this origin only: `/api/x` is proxied to `${BACKEND_URL}/x`
    // (the `/api` prefix is dropped). Server Components skip this and call BACKEND_URL directly.
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/:path*` }];
  },
};

export default nextConfig;

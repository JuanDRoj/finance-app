import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const BASE_EXTENSIONS = ["tsx", "ts", "jsx", "js"];

/**
 * Extensions Next.js accepts for route files (`page`, `layout`...). The component catalog lives in
 * `page.dev.tsx` / `layout.dev.tsx`: the `dev.tsx` extension exists only for `next dev`, so in
 * `next build` / `next start` the route is not registered and nothing of it is compiled.
 */
export function pageExtensionsFor(phase: string): string[] {
  return phase === PHASE_DEVELOPMENT_SERVER ? [...BASE_EXTENSIONS, "dev.tsx"] : BASE_EXTENSIONS;
}

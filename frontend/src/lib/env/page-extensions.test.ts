import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants";
import { describe, expect, it } from "vitest";
import { pageExtensionsFor } from "./page-extensions";

describe("pageExtensionsFor", () => {
  it("accepts the dev-only route files (the component catalog) in next dev", () => {
    expect(pageExtensionsFor(PHASE_DEVELOPMENT_SERVER)).toContain("dev.tsx");
  });

  it.each([PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER])(
    "does not accept them in %s, so the catalog never reaches production",
    (phase) => {
      expect(pageExtensionsFor(phase)).not.toContain("dev.tsx");
      expect(pageExtensionsFor(phase)).toEqual(["tsx", "ts", "jsx", "js"]);
    },
  );

  it("does not accept them for an unknown phase either", () => {
    expect(pageExtensionsFor("phase-something-new")).not.toContain("dev.tsx");
  });
});

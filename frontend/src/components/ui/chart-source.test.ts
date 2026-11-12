import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Source guards on `chart.tsx`, like `focus.test.ts` (the project proyecto "unit" reads files; jsdom
// applies no CSS, so the classes are what can be read).
const file = readFileSync(new URL("./chart.tsx", import.meta.url), "utf8");
// The code, without the comments that explain what was left out of shadcn's version.
const source = file
  .split("\n")
  .filter((line) => !/^\s*(\/\*\*|\*|\/\/)/.test(line))
  .join("\n");

describe("the focus of a chart", () => {
  it("stays visible: the <svg> is focusable (accessibilityLayer) and has the project's ring", () => {
    // Never `outline-hidden` / `outline-none`: shadcn's version hides the outline of the surface,
    // which leaves a keyboard user with no sign of where the focus is.
    expect(source).not.toMatch(/outline-(none|hidden)/);
    for (const part of ["outline-solid", "outline-2", "outline-offset-2", "outline-ring"]) {
      expect(source).toContain(`[&_.recharts-surface]:focus-visible:${part}`);
    }
  });
});

describe("the shape and the colors of a chart", () => {
  it("does not force a 16:9 shape on the chart: the height is the caller's", () => {
    expect(source).not.toMatch(/aspect-video/);
  });

  it("takes the color of a series from the tokens, not from a per-theme <style> under .dark", () => {
    expect(source).not.toMatch(/dangerouslySetInnerHTML|\.dark/);
  });
});

import { describe, expect, it } from "vitest";
import { focusRing, focusRingForced } from "./focus";

describe("focus ring", () => {
  it("is a solid outline in the ring color, 2 px wide, with an offset", () => {
    for (const classes of [focusRing, focusRingForced]) {
      expect(classes).toMatch(/outline-solid/);
      expect(classes).toMatch(/outline-2/);
      expect(classes).toMatch(/outline-offset-2/);
      // Solid ring token, no opacity (docs/diseno.md D14: 3:1 minimum).
      expect(classes).toMatch(/outline-ring(\s|$)/);
    }
  });

  it("never uses outline-none or outline-hidden, which would hide the ring (--tw-outline-style: none)", () => {
    expect(focusRing).not.toMatch(/outline-(none|hidden)/);
    expect(focusRingForced).not.toMatch(/outline-(none|hidden)/);
  });

  it("only paints on keyboard focus", () => {
    expect(focusRing.split(" ").every((c) => c.startsWith("focus-visible:"))).toBe(true);
  });
});

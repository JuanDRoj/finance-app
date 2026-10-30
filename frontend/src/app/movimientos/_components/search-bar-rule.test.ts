import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The bottom bar goes away while the search box has the focus (docs/diseno.md D19, FE-33): that is a
// rule of `globals.css` that names a slot of `search-box.tsx` and the slot of `bottom-nav.tsx`. jsdom
// does not apply CSS, so what is checked is that the three agree, reading the files as text, like the
// rule of the toast over the bar in `tokens.test.ts`.
const css = readFileSync(new URL("../../globals.css", import.meta.url), "utf8");
const searchBox = readFileSync(new URL("./search-box.tsx", import.meta.url), "utf8");
const bottomNav = readFileSync(
  new URL("../../../components/bottom-nav.tsx", import.meta.url),
  "utf8",
);

const RULE =
  /body:has\(\[data-slot="([\w-]+)"\] input:focus\)\s+\[data-slot="([\w-]+)"\]\s*\{([^}]*)\}/;

describe("the rule that hides the bottom bar while the search box has the focus", () => {
  const match = RULE.exec(css);

  it("exists in globals.css: a field focused inside the search hides the bar", () => {
    expect(match, "the rule is in globals.css").not.toBeNull();
    expect(match![3]!.replace(/\s+/g, " ").trim()).toBe("display: none;");
  });

  it("names the slot that the search box has", () => {
    expect(searchBox).toContain(`data-slot="${match![1]}"`);
  });

  it("names the slot that the bottom bar has", () => {
    expect(bottomNav).toContain(`data-slot="${match![2]}"`);
  });

  it("is about the input that has the focus, not about the whole search form", () => {
    expect(RULE.source).toContain("input:focus");
    expect(css).not.toMatch(/data-slot="movement-search"\]\s*\{[^}]*display:\s*none/);
  });

  it("leaves the rule of the toast over the bar as it was: it still looks for the bar's slot", () => {
    expect(css).toContain('body:has([data-slot="bottom-nav"]) {');
  });
});

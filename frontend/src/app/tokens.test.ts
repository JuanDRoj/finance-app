import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

// :root blocks in file order: light palette, dark palette (inside prefers-color-scheme), fallbacks.
const rootBlocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((match) => match[1] ?? "");

function declarations(block: string): Map<string, string> {
  return new Map(
    [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [
      match[1] ?? "",
      (match[2] ?? "").trim(),
    ]),
  );
}

const light = declarations(rootBlocks[0] ?? "");
const dark = new Map([...light, ...declarations(rootBlocks[1] ?? "")]);

/** Solid hex color of a token, following `var(--other)` aliases (e.g. --income: var(--primary)). */
function hexOf(palette: Map<string, string>, token: string): string {
  const value = palette.get(token);
  if (value === undefined) throw new Error(`Token --${token} is not defined`);
  const alias = /^var\(--([\w-]+)\)$/.exec(value);
  if (alias) return hexOf(palette, alias[1] ?? "");
  if (!/^#[0-9a-f]{6}$/i.test(value))
    throw new Error(`--${token} is not a solid hex color: ${value}`);
  return value;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

// [foreground token, background token, minimum ratio, ratio documented in docs/diseno.md D14
// (undefined where D14 has no number for the pair)]
// 4.5 for text, 3 for icons and focus rings (WCAG AA). Glass over a blob is checked in KAN-34.
type Pair = [string, string, number, { light: number; dark: number } | undefined];
const PAIRS: Pair[] = [
  ["foreground", "background", 4.5, { light: 15.84, dark: 17.15 }],
  ["muted-foreground", "background", 4.5, { light: 5.86, dark: 8.91 }],
  ["muted-foreground", "muted", 4.5, { light: 5.35, dark: 7.65 }],
  ["primary-foreground", "primary", 4.5, { light: 6.24, dark: 10.27 }],
  ["secondary-foreground", "secondary", 4.5, { light: 8.05, dark: 9.38 }],
  ["foreground", "accent", 4.5, { light: 14.63, dark: 13.15 }],
  ["destructive", "background", 4.5, { light: 5.8, dark: 9.4 }],
  ["destructive-foreground", "destructive", 4.5, { light: 6.54, dark: 8.97 }],
  ["primary", "background", 4.5, { light: 5.54, dark: 11.48 }],
  ["debt", "background", 4.5, { light: 5.13, dark: 10.38 }],
  ["income", "background", 4.5, { light: 5.54, dark: 11.48 }],
  ["expense", "background", 4.5, { light: 15.84, dark: 17.15 }],
  ["foreground", "card-solid", 4.5, undefined],
  ["popover-foreground", "popover", 4.5, undefined],
  ["ring", "background", 3, { light: 5.54, dark: 11.48 }],
];

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("%s palette", (name, palette) => {
  it.each(PAIRS)(
    "%s on %s reaches the WCAG AA ratio",
    (foreground, background, minimum, documented) => {
      const ratio = contrast(hexOf(palette, foreground), hexOf(palette, background));
      expect(ratio).toBeGreaterThanOrEqual(minimum);
      // The ratios of docs/diseno.md D14 were computed by hand: a mismatch means the CSS drifted.
      if (documented) expect(ratio).toBeCloseTo(documented[name], 1);
    },
  );
});

describe("tokens", () => {
  it("defines the same tokens in the light and dark palettes", () => {
    for (const token of declarations(rootBlocks[1] ?? "").keys()) {
      expect(light.has(token), `--${token} exists in the light palette`).toBe(true);
    }
  });

  it("keeps the theme-color values of layout.tsx in sync with --background", () => {
    const layout = readFileSync(new URL("./layout.tsx", import.meta.url), "utf8");
    expect(layout.toLowerCase()).toContain(hexOf(light, "background"));
    expect(layout.toLowerCase()).toContain(hexOf(dark, "background"));
  });

  it("declares glass with both the standard and the -webkit- backdrop-filter", () => {
    expect(css).toMatch(/-webkit-backdrop-filter:\s*blur/);
    expect(css).toMatch(/(?<!-webkit-)backdrop-filter:\s*blur/);
  });
});

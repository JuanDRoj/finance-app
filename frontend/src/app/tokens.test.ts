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
// 4.5 for text, 3 for icons and focus rings (WCAG AA). Glass over a blob is checked further down.
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

// Default focus outline of every element: `@apply ... outline-ring` (or `outline-ring/50`) in the
// base layer. The color that is really painted is the ring token blended with this opacity over
// the surface behind it, so a translucent outline can fall under 3:1 even if the token passes.
function baseOutlineOpacity(): number {
  const used = [...css.matchAll(/@apply[^;]*\boutline-ring(?:\/(\d+))?(?=[\s;])/g)];
  expect(used, "the base layer sets a default outline color from the ring token").toHaveLength(1);
  return used[0]?.[1] === undefined ? 1 : Number(used[0][1]) / 100;
}

function blend(foreground: string, background: string, alpha: number): string {
  const channels = [1, 3, 5].map((start) => {
    const front = Number.parseInt(foreground.slice(start, start + 2), 16);
    const back = Number.parseInt(background.slice(start, start + 2), 16);
    return Math.round(front * alpha + back * (1 - alpha))
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("default focus outline, %s palette", (_name, palette) => {
  it.each(["background", "card-solid", "popover", "muted", "secondary"])(
    "reaches 3:1 (WCAG non-text contrast) on %s",
    (surface) => {
      const surfaceHex = hexOf(palette, surface);
      const painted = blend(hexOf(palette, "ring"), surfaceHex, baseOutlineOpacity());
      expect(contrast(painted, surfaceHex)).toBeGreaterThanOrEqual(3);
    },
  );
});

// Pairs that components use on solid surfaces (KAN-34): placeholder and disabled text, error text,
// the secondary button, the icon of an empty state.
const COMPONENT_PAIRS: [string, string, number][] = [
  ["muted-foreground", "card-solid", 4.5], // placeholder and help text in a field
  ["muted-foreground", "popover", 4.5],
  ["destructive", "card-solid", 4.5], // error text and the title of an error Alert
  ["destructive", "popover", 4.5],
  ["foreground", "card-solid", 4.5],
  ["primary", "secondary", 3], // duotone icon of an empty state (non-text)
  ["primary", "card-solid", 4.5], // link buttons
  ["secondary-foreground", "secondary", 4.5],
];

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("component pairs, %s palette", (_name, palette) => {
  it.each(COMPONENT_PAIRS)("%s on %s reaches %s:1", (foreground, background, minimum) => {
    expect(contrast(hexOf(palette, foreground), hexOf(palette, background))).toBeGreaterThanOrEqual(
      minimum,
    );
  });
});

// Translucent tokens (rgba). They are painted over the page background, and a decorative blob
// can sit under them, so every combination is composited before measuring.
function rgbaOf(palette: Map<string, string>, token: string): { hex: string; alpha: number } {
  const value = palette.get(token) ?? "";
  const match = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  if (!match) throw new Error(`--${token} is not an rgba() color: ${value}`);
  const hex = [match[1], match[2], match[3]]
    .map((channel) => Number(channel).toString(16).padStart(2, "0"))
    .join("");
  return { hex: `#${hex}`, alpha: Number(match[4]) };
}

/** What is painted when a translucent token sits over a solid color. */
function over(palette: Map<string, string>, token: string, under: string): string {
  const { hex, alpha } = rgbaOf(palette, token);
  return blend(hex, under, alpha);
}

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("translucent surfaces, %s palette", (_name, palette) => {
  // What can be behind a glass surface: the page background or one of the two blobs.
  const grounds = ["background", "blob-1", "blob-2"].map(
    (token) => [token, hexOf(palette, token)] as const,
  );
  const glassSurfaces = ["card", "glass", "glass-strong"];

  describe.each(glassSurfaces)("text on %s", (surface) => {
    it.each(["foreground", "muted-foreground", "primary", "debt"])(
      "%s reaches 4.5:1 over every ground",
      (text) => {
        for (const [, ground] of grounds) {
          const surfaceHex = over(palette, surface, ground);
          expect(contrast(hexOf(palette, text), surfaceHex)).toBeGreaterThanOrEqual(4.5);
        }
      },
    );
  });

  // The control border (--input) is painted over the surface behind it: 3:1 (WCAG non-text).
  // `Input` paints card-solid under its own border, but outline buttons and any control that
  // is transparent would sit on glass, so every surface is checked.
  describe("the --input border (3:1)", () => {
    it.each(["background", "card-solid", "popover", "muted"])("over %s", (surface) => {
      const surfaceHex = hexOf(palette, surface);
      expect(contrast(over(palette, "input", surfaceHex), surfaceHex)).toBeGreaterThanOrEqual(3);
    });

    it.each(glassSurfaces)("over %s, with a blob or the background behind", (surface) => {
      for (const [, ground] of grounds) {
        const surfaceHex = over(palette, surface, ground);
        expect(contrast(over(palette, "input", surfaceHex), surfaceHex)).toBeGreaterThanOrEqual(3);
      }
    });
  });
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

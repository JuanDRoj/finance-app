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
  // Desktop cards (Escritorio v2, KAN-91): the text of a card is measured on `surface`, and the
  // icons of its containers (`primary` on `primary-soft`) as non-text, 3:1.
  ["foreground", "surface", 4.5, { light: 17.85, dark: 15.04 }],
  ["muted-foreground", "surface", 4.5, { light: 6.6, dark: 7.81 }],
  ["primary", "surface", 4.5, { light: 6.24, dark: 10.07 }],
  ["debt", "surface", 4.5, { light: 5.78, dark: 9.1 }],
  ["destructive", "surface", 4.5, { light: 6.54, dark: 8.24 }],
  ["primary", "primary-soft", 3, { light: 5.36, dark: 7.41 }],
  ["ring", "background", 3, { light: 5.54, dark: 11.48 }],
  // Desktop sidebar (KAN-41, D17), with the values of the Kanza canvas. It is dark in both themes
  // (#0E1A14 in light, #13241B in dark). Idle icons need 3:1 (non-text); 4.5 is asked for so the
  // same pair also serves for text.
  ["sidebar-foreground", "sidebar", 4.5, { light: 8.3, dark: 7.54 }], // idle icons
  ["sidebar-primary", "sidebar", 3, { light: 10.7, dark: 9.71 }], // active icon and its mark
  ["sidebar-primary-foreground", "sidebar-primary", 4.5, { light: 10.27, dark: 10.27 }], // counter
  ["sidebar-ring", "sidebar", 3, { light: 10.7, dark: 9.71 }], // focus ring on the sidebar
  // Escritorio v2 (KAN-69): the name of the space and of the user, the name of a section at rest,
  // and the initial of the space and the avatar on their tile.
  ["sidebar-title", "sidebar", 4.5, { light: 15.98, dark: 14.51 }],
  ["sidebar-text", "sidebar", 4.5, { light: 11.56, dark: 10.5 }],
  ["sidebar-tile-foreground", "sidebar-tile", 4.5, { light: 9.38, dark: 9.38 }],
  ["tooltip-foreground", "tooltip", 4.5, { light: 15.98, dark: 15.98 }], // text of the tooltip
  ["tooltip", "background", 3, { light: 15.84, dark: 17.15 }], // the tooltip stands out of the page
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
  it.each(["background", "card-solid", "popover", "muted", "secondary", "surface"])(
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
  ["debt", "card-solid", 4.5], // the figures of a card's debt in the money field (tone="debt")
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
    it.each(["background", "card-solid", "popover", "muted", "surface"])("over %s", (surface) => {
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

// The side panel, the dialogs and the bottom sheet (KAN-91) open over a veil (`scrim`) that darkens
// the page. The panel and the sheet are `glass-strong`, so what is behind them is the page (or a
// blob) already darkened by the veil: the text on them is measured on that composite.
describe.each([
  ["light", light],
  ["dark", dark],
] as const)("glass-strong over the scrim, %s palette", (_name, palette) => {
  const grounds = ["background", "blob-1", "blob-2"].map((token) => hexOf(palette, token));
  it.each(["foreground", "muted-foreground", "primary", "debt"])(
    "%s reaches 4.5:1 over every ground",
    (text) => {
      for (const ground of grounds) {
        const surfaceHex = over(palette, "glass-strong", over(palette, "scrim", ground));
        expect(contrast(hexOf(palette, text), surfaceHex)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it("keeps the --input border at 3:1 over it", () => {
    for (const ground of grounds) {
      const surfaceHex = over(palette, "glass-strong", over(palette, "scrim", ground));
      expect(contrast(over(palette, "input", surfaceHex), surfaceHex)).toBeGreaterThanOrEqual(3);
    }
  });
});

// The sidebar's hover and active background is a translucent mint (--sidebar-accent) painted over
// the sidebar itself, so the pairs are measured on the composited color, as for the glass above.
const SIDEBAR_STATE_PAIRS: [string, number, { light: number; dark: number }][] = [
  ["sidebar-foreground", 4.5, { light: 6.15, dark: 5.45 }], // idle icon under the pointer
  ["sidebar-primary", 3, { light: 7.93, dark: 7.03 }], // active icon on its pill
  ["sidebar-ring", 3, { light: 7.93, dark: 7.03 }], // focus ring next to the pill
  ["sidebar-text", 4.5, { light: 8.57, dark: 7.59 }], // name of a section at rest, under the pointer
];

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("sidebar hover and active state, %s palette", (name, palette) => {
  it.each(SIDEBAR_STATE_PAIRS)("%s reaches %s:1 on the composited pill", (token, minimum, doc) => {
    const pill = over(palette, "sidebar-accent", hexOf(palette, "sidebar"));
    const ratio = contrast(hexOf(palette, token), pill);
    expect(ratio).toBeGreaterThanOrEqual(minimum);
    expect(ratio).toBeCloseTo(doc[name], 1);
  });
});

// The row of the space (`sidebar-surface`, a 5 % white over the sidebar) holds the name and the
// currency, so those texts are measured on the composited color.
const SIDEBAR_SURFACE_PAIRS: [string, number, { light: number; dark: number }][] = [
  ["sidebar-title", 4.5, { light: 14.15, dark: 12.6 }], // name of the space
  ["sidebar-foreground", 4.5, { light: 7.35, dark: 6.54 }], // currency, and the email
];

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("sidebar space row, %s palette", (name, palette) => {
  it.each(SIDEBAR_SURFACE_PAIRS)("%s reaches %s:1 on the composited row", (token, minimum, doc) => {
    const row = over(palette, "sidebar-surface", hexOf(palette, "sidebar"));
    const ratio = contrast(hexOf(palette, token), row);
    expect(ratio).toBeGreaterThanOrEqual(minimum);
    expect(ratio).toBeCloseTo(doc[name], 1);
  });
});

// The active tab of the bottom bar (KAN-69): its label is `primary` text (11 px, so 4.5:1) on a
// pill of `primary` at a small alpha, over `glass`, over the page or one of the blobs. The alphas
// are read from the component, so the test cannot drift from it. The pill is 10 % in the light
// theme because 12 % gives 4.47:1 over the first blob; that blob is at the top of the page, but
// the worst case is held anyway.
describe("active tab of the bottom bar", () => {
  const source = readFileSync(new URL("../components/bottom-nav.tsx", import.meta.url), "utf8");
  const lightAlpha = Number(/(?<![:\w])bg-primary\/(\d+)/.exec(source)?.[1]) / 100;
  const darkAlpha = Number(/dark:bg-primary\/(\d+)/.exec(source)?.[1]) / 100;

  it("reads the alphas of the pill from the component", () => {
    expect(lightAlpha).toBe(0.1);
    expect(darkAlpha).toBe(0.14);
  });

  describe.each([
    ["light", light, lightAlpha, { background: 5.13, "blob-1": 4.61, "blob-2": 4.95 }],
    ["dark", dark, darkAlpha, { background: 7.91, "blob-1": 5.21, "blob-2": 6.25 }],
  ] as const)("%s palette", (_name, palette, alpha, documented) => {
    it.each(["background", "blob-1", "blob-2"] as const)(
      "keeps the label at 4.5:1 over %s",
      (ground) => {
        const glass = over(palette, "glass", hexOf(palette, ground));
        const pill = blend(hexOf(palette, "primary"), glass, alpha);
        const ratio = contrast(hexOf(palette, "primary"), pill);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
        expect(ratio).toBeCloseTo(documented[ground], 1);
      },
    );
  });
});

describe("bottom bar and toast", () => {
  it("states the bar's height (68 px) and its distance from the edge (12 px or the safe area)", () => {
    expect(light.get("bottom-nav-height")).toBe("68px");
    expect(light.get("bottom-nav-offset")).toBe("max(12px, env(safe-area-inset-bottom, 0px))");
  });

  it("raises the toast 20 px above the bar, only on a page that has the bar", () => {
    const rule = /body:has\(\[data-slot="bottom-nav"\]\)\s*\{([^}]*)\}/.exec(css);
    expect(rule, "a rule for a body that has the bottom bar").not.toBeNull();
    expect(declarations(rule?.[1] ?? "").get("toast-offset-bottom")).toBe(
      "calc(var(--bottom-nav-offset) + var(--bottom-nav-height) + 20px)",
    );
    // Not defined for every page: a form without the bar keeps the Toaster's own offset.
    expect(light.has("toast-offset-bottom")).toBe(false);
  });

  it("is the same variable the Toaster reads", () => {
    const toaster = readFileSync(new URL("../components/ui/sonner.tsx", import.meta.url), "utf8");
    expect(toaster).toContain("var(--toast-offset-bottom,");
  });
});

describe("tokens", () => {
  it("defines the colors of Escritorio v2 for the sidebar once, with the same value in both themes", () => {
    for (const token of [
      "sidebar-title",
      "sidebar-text",
      "sidebar-surface",
      "sidebar-line",
      "sidebar-tile",
      "sidebar-tile-foreground",
    ]) {
      expect(light.has(token), `--${token} is in the light block`).toBe(true);
      expect(declarations(rootBlocks[1] ?? "").has(token), `--${token} is not repeated`).toBe(
        false,
      );
    }
  });

  it("defines the desktop-card tokens of Escritorio v2 (KAN-91) with the values of the canvas", () => {
    expect(hexOf(light, "surface").toLowerCase()).toBe("#ffffff");
    expect(hexOf(dark, "surface").toLowerCase()).toBe("#142019");
    expect(hexOf(light, "primary-soft").toLowerCase()).toBe("#e3f1ea");
    expect(hexOf(dark, "primary-soft").toLowerCase()).toBe("#173b2c");
    // A card is a solid surface: no alpha, so no blob shows through and no blur is needed.
    expect(light.get("surface")).toMatch(/^#[0-9a-f]{6}$/i);
    expect(dark.get("surface")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("defines the veil: light and faint on a light page, darker on a dark one", () => {
    expect(light.get("scrim")).toBe("rgba(8, 17, 13, 0.22)");
    expect(dark.get("scrim")).toBe("rgba(0, 0, 0, 0.55)");
  });

  it("defines the shape, shadow and size tokens of the panel and the dialog in @theme", () => {
    const theme = declarations(/@theme\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "");
    expect(theme.get("radius-card")).toBe("1.25rem"); // 20 px
    expect(theme.get("radius-dialog")).toBe("1.5rem"); // 24 px
    expect(theme.get("text-panel-title")).toBe("1.375rem"); // 22 px
    expect(theme.get("shadow-panel")).toBe("-16px 0 40px rgba(0, 0, 0, 0.16)");
    expect(theme.get("shadow-dialog")).toBe("0 24px 60px rgba(0, 0, 0, 0.22)");
    expect(theme.get("shadow-sheet")).toBe("0 -10px 30px rgba(0, 0, 0, 0.16)");
  });

  it("makes a tile glass below 1024 px and a solid surface from 1024 px (no blur there)", () => {
    const utility = /@utility tile-surface\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(utility).toContain("background-color: var(--card)");
    expect(utility).toMatch(
      /@media \(min-width: 64rem\)\s*\{[^}]*background-color: var\(--surface\)/,
    );
    expect(utility).toMatch(/@media \(min-width: 64rem\)\s*\{[^}]*backdrop-filter: none/);
  });

  it("defines the same tokens in the light and dark palettes", () => {
    for (const token of declarations(rootBlocks[1] ?? "").keys()) {
      expect(light.has(token), `--${token} exists in the light palette`).toBe(true);
    }
  });

  it("keeps the sidebar dark in both themes, with its own value in each", () => {
    // "Dark": the surface's relative luminance is far below the page background of the light theme.
    expect(luminance(hexOf(light, "sidebar"))).toBeLessThan(0.02);
    expect(luminance(hexOf(dark, "sidebar"))).toBeLessThan(0.02);
    // The canvas uses a different sidebar in each theme: #0E1A14 in light, #13241B in dark.
    expect(hexOf(light, "sidebar").toLowerCase()).toBe("#0e1a14");
    expect(hexOf(dark, "sidebar").toLowerCase()).toBe("#13241b");
  });

  it("keeps the tooltip of the sidebar icons inverted against the page", () => {
    // Dark on a light page, light on a dark page.
    expect(luminance(hexOf(light, "tooltip"))).toBeLessThan(luminance(hexOf(light, "background")));
    expect(luminance(hexOf(dark, "tooltip"))).toBeGreaterThan(luminance(hexOf(dark, "background")));
  });

  it("needs its own focus ring on the sidebar: --ring (light) is under 3:1 there", () => {
    // If this ever starts failing, --ring got stronger and --sidebar-ring could be dropped.
    expect(contrast(hexOf(light, "ring"), hexOf(light, "sidebar"))).toBeLessThan(3);
    // In the dark theme --ring is the same mint, so nothing is lost by using the sidebar's own.
    expect(contrast(hexOf(dark, "ring"), hexOf(dark, "sidebar"))).toBeGreaterThanOrEqual(3);
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

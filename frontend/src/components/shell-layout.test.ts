import { describe, expect, it } from "vitest";
import { DESKTOP_GROUP_VERTICAL_PADDING, SIDEBAR_CARD_POSITION } from "./shell-layout";

// A short desktop page is exactly one screen tall only if the sticky card plus the group's padding
// add up to 100dvh, whatever the safe-area insets are. The classes are strings, so the test reads
// them back and does the arithmetic of CSS `max()` and `calc()` for a few insets.
const REM = 16;
const MAX_BODY = String.raw`max\([\d.]+rem,env\(safe-area-inset-(?:top|bottom),0px\)\)`;
// The same, capturing the rem and the side.
const MAX = String.raw`max\(([\d.]+)rem,env\(safe-area-inset-(top|bottom),0px\)\)`;

type Insets = { top: number; bottom: number };

/** The value of a `max(Nrem, env(safe-area-inset-SIDE, 0px))` expression, in px. */
function resolveMax(expression: string, insets: Insets): number {
  const match = new RegExp(`^${MAX}$`).exec(expression);
  if (!match) throw new Error(`Not a max(rem, inset) expression: ${expression}`);
  return Math.max(Number(match[1]) * REM, insets[match[2] as keyof Insets]);
}

function classValue(classes: string, pattern: RegExp): string {
  const match = pattern.exec(classes);
  if (!match?.[1]) throw new Error(`${pattern} not found in: ${classes}`);
  return match[1];
}

const groupTop = classValue(DESKTOP_GROUP_VERTICAL_PADDING, /(?:^|\s)lg:pt-\[(.+?\))\](?:\s|$)/);
const groupBottom = classValue(DESKTOP_GROUP_VERTICAL_PADDING, /(?:^|\s)lg:pb-\[(.+?\))\](?:\s|$)/);
const cardTop = classValue(SIDEBAR_CARD_POSITION, /(?:^|\s)top-\[(.+?\))\](?:\s|$)/);
const cardHeight = new RegExp(`^calc\\(100dvh-(${MAX_BODY})-(${MAX_BODY})\\)$`).exec(
  classValue(SIDEBAR_CARD_POSITION, /(?:^|\s)h-\[(calc\(.+\))\](?:\s|$)/),
);

const INSETS: Insets[] = [
  { top: 0, bottom: 0 }, // a desktop
  { top: 20, bottom: 0 }, // an inset under the gutter
  { top: 24, bottom: 34 }, // an iPad in landscape with the home indicator
  { top: 59, bottom: 34 }, // an iPhone with a Dynamic Island
];

describe("sidebar card and desktop group", () => {
  it("reads the card height as a screen minus a top and a bottom `max()`", () => {
    expect(cardHeight).not.toBeNull();
  });

  it.each(INSETS)("add up to exactly one screen, with insets %o", (insets) => {
    const screen = 900;
    const above = resolveMax(groupTop, insets);
    const below = resolveMax(groupBottom, insets);
    const card =
      screen -
      resolveMax(cardHeight?.[1] ?? "", insets) -
      resolveMax(cardHeight?.[2] ?? "", insets);
    // group padding + card = the document of a short page.
    expect(above + card + below).toBe(screen);
  });

  it("uses the group's own top padding as the card's sticky offset", () => {
    expect(cardTop).toBe(groupTop);
  });

  it("subtracts the group's own padding, top and bottom, from the card height", () => {
    expect(cardHeight?.[1]).toBe(groupTop);
    expect(cardHeight?.[2]).toBe(groupBottom);
  });

  it("is 40 px less than a screen without insets (16 px above, 24 px below)", () => {
    const none: Insets = { top: 0, bottom: 0 };
    expect(resolveMax(groupTop, none)).toBe(16);
    expect(resolveMax(groupBottom, none)).toBe(24);
  });
});

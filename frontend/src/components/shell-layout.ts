/**
 * The vertical measures that the desktop sidebar and the group around it must agree on
 * (docs/diseno.md D17). They are whole class strings on purpose: Tailwind finds classes by reading
 * the source as text, so they cannot be assembled from pieces at run time.
 *
 * On a short page the document is as tall as the group: the group's padding above and below plus
 * the sticky card, which is a normal block in a column. So the card has to be exactly one screen
 * minus that padding, with the same `max(gutter, safe-area inset)` on both sides; if the card were
 * 8 px taller, a short page would scroll by 8 px. `shell-layout.test.ts` pins the arithmetic for any
 * inset. The air under the card is then 24 px, not 16: that is what the canvas does too (its group
 * has 16 px above and 24 px below).
 */

/** Padding above and below the desktop group (the sidebar and the content). */
export const DESKTOP_GROUP_VERTICAL_PADDING =
  "lg:pt-[max(1rem,env(safe-area-inset-top,0px))] lg:pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]";

/** Where the sidebar card sticks and how tall it is: a screen minus the group's padding. */
export const SIDEBAR_CARD_POSITION =
  "sticky top-[max(1rem,env(safe-area-inset-top,0px))] h-[calc(100dvh-max(1rem,env(safe-area-inset-top,0px))-max(1.5rem,env(safe-area-inset-bottom,0px)))]";

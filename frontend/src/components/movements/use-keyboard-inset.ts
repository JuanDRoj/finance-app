"use client";

import { useSyncExternalStore } from "react";

/**
 * Below this many pixels the difference between the layout viewport and the visual one is the
 * browser's own bars (Safari's toolbar, an address bar that collapses), not a keyboard: a keyboard
 * is never shorter than this.
 */
export const MIN_KEYBOARD_INSET = 100;

function subscribe(onChange: () => void): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  viewport.addEventListener("resize", onChange);
  viewport.addEventListener("scroll", onChange);
  return () => {
    viewport.removeEventListener("resize", onChange);
    viewport.removeEventListener("scroll", onChange);
  };
}

/** The pixels the keyboard covers now; a number, so the same value is the same snapshot. */
function readInset(): number {
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  const covered = Math.round(window.innerHeight - viewport.height - viewport.offsetTop);
  return covered >= MIN_KEYBOARD_INSET ? covered : 0;
}

/**
 * How many pixels the on-screen keyboard covers at the bottom of the layout viewport, or 0.
 *
 * Android Chrome shrinks the layout viewport when the keyboard opens (`interactiveWidget:
 * "resizes-content"` in `layout.tsx`), so a bottom sheet that is `fixed` to the bottom already rides
 * above it and this is 0. iOS Safari does **not**: the layout viewport keeps its height, the
 * keyboard covers the bottom of the page, and a `fixed` sheet ends up with its button behind it. The
 * Visual Viewport API tells how much of the page the keyboard hides: the layout height minus the
 * visible height minus how far the visible area is scrolled down. The sheet of "Registrar movimiento"
 * lifts its bottom edge by that amount (docs/diseno.md D19: the button stays above the keyboard).
 *
 * It says 0 where the API does not exist (the server, an old browser) so the sheet keeps its normal
 * place, and while not `active` (the sheet is closed, or it is the side panel of desktop).
 */
export function useKeyboardInset(active: boolean): number {
  const inset = useSyncExternalStore(subscribe, readInset, () => 0);
  return active ? inset : 0;
}

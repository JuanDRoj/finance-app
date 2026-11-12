"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { MouseHandlerDataParam } from "recharts";

// Escape closes the tooltip of a chart (FE-36, KAN-102; WCAG 2.2 1.4.13, "Content on Hover or
// Focus": what shows up on hover or focus must be dismissible without moving the pointer or the
// focus). What Recharts 3.10.1 does by itself: the box of its tooltip listens for Escape on
// `document` (whatever has the focus) and hides itself (`visibility: hidden`) until the tooltip
// moves. What it leaves: the column highlighted behind it, the card still mounted (hidden, with its
// `aria-live`), a key that goes on to close whatever dialog holds the chart, and the arrow that moves
// to the same coordinate (the first or the last month) not showing it again. The Tooltip's `active`
// prop completes it: `false` keeps everything hidden (box, column and card) and `undefined` hands
// control back to Recharts, so the hook only has to say when to stop and when to resume.
// It lives in the body of each chart, which already is client code loaded only from 1024 px.

/** What the tooltip card of both charts carries, so a key handler can tell whether one is showing. */
export const CHART_TOOLTIP_SELECTOR = '[data-slot="chart-tooltip"]';

/**
 * Two places hear the Escape, depending on where the focus is:
 *
 * - **Focus in the chart** (its `<svg>`): the container's `onKeyDown`. It hides the tooltip while one
 *   is showing, leaves the focus where it is and swallows the key (`stopPropagation`), so a dialog
 *   or sheet around the chart does not also close on that same press. With no tooltip showing,
 *   Escape goes on its way as usual.
 * - **Focus elsewhere**, with the tooltip open because the mouse is over the chart: a `keydown`
 *   listener on `document`, which exists **only while the tooltip is showing** (the card reports it
 *   with `onShownChange`, see `chart-tooltip-card.tsx`) and is removed when it goes or the chart
 *   unmounts. Recharts' own box already hides itself here; this listener is what hides the column
 *   behind it and takes the card out (`active`). It does not swallow the key, so whatever else
 *   listens for Escape still hears it. If the focus is in an open dialog and the mouse is over a
 *   chart behind it (it cannot happen today: no chart lives under a dialog), that Escape hides the
 *   chart's tooltip *and* closes the dialog, both of which is what the person asked for.
 *
 * The two never act on the same press: when the container handles an Escape it stops it, and the
 * `document` listeners (this one and Recharts' own, which hear the key last, bubbling up) never get it.
 *
 * What brings the tooltip back after an Escape:
 *
 * - **The mouse, on another month.** The hook keeps the month that was showing when Escape came
 *   (`dismissedAt`) and the chart's `onMouseMove` (`chartProps`) says which month the pointer is on:
 *   only a different one resumes, so a tremor of the hand inside the same column does not paint the
 *   highlight again while Recharts' box (which comes back only when the tooltip moves) stays hidden.
 *   Over the padding of the chart, with no month under it, nothing resumes. When the pointer leaves
 *   the chart the month is forgotten, so coming back in over any month, the same one included, shows
 *   the tooltip again.
 * - **An arrow**, always. The chart moves to the next or the previous month and the tooltip comes
 *   with it. At the first or the last month the arrow does not move, and the tooltip comes back at
 *   that same month: pressing an arrow says the person wants to read it, and a key that seems to do
 *   nothing would be the odd answer. (That is the Escape closed from inside the chart, where
 *   Recharts' own box was never dismissed because the container swallowed the key.)
 *
 * Tab and every other key are left alone (Recharts itself shows nothing when the chart is focused
 * again until an arrow comes).
 *
 * Pass `active` and `resetKey` (as its `key`) to the chart's `ChartTooltip`, `containerProps` to its
 * `ChartContainer`, `chartProps` to the chart itself and `onShownChange` to its tooltip card.
 */
export function useDismissibleTooltip() {
  const [dismissed, setDismissed] = useState(false);
  const [shown, setShown] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  /** The month showing right now (`null`: none) and the one that was showing when Escape came. */
  const shownAt = useRef<string | null>(null);
  const dismissedAt = useRef<string | null>(null);
  const isDismissed = useRef(false);

  const onShownChange = useCallback((index: string | null) => {
    shownAt.current = index;
    setShown(index !== null);
  }, []);

  const dismiss = useCallback(() => {
    dismissedAt.current = shownAt.current;
    isDismissed.current = true;
    setDismissed(true);
  }, []);

  // Bringing the tooltip back also remounts the Recharts one (`resetKey`, the `key` of the
  // `ChartTooltip`): its box keeps its own "dismissed" memory, tied to the position where Escape
  // found it, and only forgets it when the tooltip moves, so coming back to that same position (the
  // pointer re-entering over the same month, an arrow at the first or the last one) would paint the
  // highlight and the card around a box that stays hidden.
  const resume = () => {
    if (!isDismissed.current) return;
    isDismissed.current = false;
    dismissedAt.current = null;
    setDismissed(false);
    setResetKey((key) => key + 1);
  };

  useEffect(() => {
    if (!shown) return;
    const onDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => document.removeEventListener("keydown", onDocumentKeyDown);
  }, [shown, dismiss]);

  return {
    active: dismissed ? false : undefined,
    resetKey,
    onShownChange,
    containerProps: {
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        if (event.key === "Escape") {
          if (event.currentTarget.querySelector(CHART_TOOLTIP_SELECTOR) === null) return;
          dismiss();
          event.stopPropagation();
        } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          resume();
        }
      },
      onMouseLeave() {
        dismissedAt.current = null;
      },
    },
    chartProps: {
      onMouseMove(state: MouseHandlerDataParam) {
        if (!isDismissed.current || state.activeTooltipIndex == null) return;
        if (String(state.activeTooltipIndex) !== dismissedAt.current) resume();
      },
    },
  };
}

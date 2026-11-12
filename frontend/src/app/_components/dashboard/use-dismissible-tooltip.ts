"use client";

import { useState, type KeyboardEvent } from "react";

// Escape closes the tooltip of a chart (FE-36, KAN-102; WCAG 2.2 1.4.13, "Content on Hover or
// Focus": what shows up on hover or focus must be dismissible without moving the pointer or the
// focus). Recharts 3 has no key for it: its accessibility layer opens the tooltip on focus, moves it
// with the arrows and only an Enter toggles it. What it does give is the Tooltip's `active` prop:
// `false` keeps the tooltip (and the column behind it) hidden whatever the chart's own state says,
// and `undefined` hands control back, so the hook only has to say when to stop and when to resume.
// It lives in the body of each chart, which already is client code loaded only from 1024 px.

/** What the tooltip card of both charts carries, so a key handler can tell whether one is showing. */
export const CHART_TOOLTIP_SELECTOR = '[data-slot="chart-tooltip"]';

/**
 * - **Escape** hides the tooltip while one is showing, without touching the focus (the chart's
 *   `<svg>` keeps it), and swallows the key then, so a dialog or sheet around the chart does not
 *   also close on that same press. With no tooltip showing, Escape goes on its way as usual.
 * - An **arrow** (the chart moves to the next or the previous month) or a **mouse move** over the
 *   chart shows the tooltip once more. Tab and every other key are left alone (Recharts itself shows
 *   nothing when the chart is focused again until an arrow comes).
 *
 * Pass `active` to the chart's `ChartTooltip` and `containerProps` to its `ChartContainer`.
 */
export function useDismissibleTooltip() {
  const [dismissed, setDismissed] = useState(false);

  // Setting a state to the value it has already costs no render.
  const resume = () => setDismissed(false);

  return {
    active: dismissed ? false : undefined,
    containerProps: {
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        if (event.key === "Escape") {
          if (event.currentTarget.querySelector(CHART_TOOLTIP_SELECTOR) === null) return;
          setDismissed(true);
          event.stopPropagation();
        } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          resume();
        }
      },
      onMouseMove: resume,
    },
  };
}

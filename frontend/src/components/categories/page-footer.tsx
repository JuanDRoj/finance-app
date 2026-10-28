"use client";

import type { ReactNode } from "react";
import { useKeyboardInset } from "@/components/movements/use-keyboard-inset";

/**
 * The bar with the main button of a category form **as a page** (below 1024 px): fixed at the bottom
 * of the screen, over the safe area, with the glass of the canvas ("H1 · Nueva categoría": a bar
 * with a top border and a 52 px button). The icon picker makes the page long, and a button at the end
 * of it would be a scroll away; docs/diseno.md D19 asks for it fixed. The form leaves room under its
 * last field (`pb-28`) so nothing hides behind it.
 *
 * Android shrinks the page when the keyboard opens (`interactiveWidget: "resizes-content"`), so
 * `fixed` already rides above it; iOS does not, and `useKeyboardInset` says how much the keyboard
 * covers so the bar goes above it (the same hook the sheet of "Registrar movimiento" uses).
 * The content is centered in the 640 px column of the shell, with its gutters.
 */
export function PageFooter({ children }: Readonly<{ children: ReactNode }>) {
  const keyboardInset = useKeyboardInset(true);
  return (
    <div
      data-slot="category-form-footer"
      className="glass fixed inset-x-0 bottom-0 z-30 rounded-none border-x-0 border-b-0 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]"
      style={keyboardInset > 0 ? { bottom: keyboardInset, paddingBottom: "0.75rem" } : undefined}
    >
      <div className="mx-auto flex max-w-160 flex-col px-[max(1rem,env(safe-area-inset-left,0px))]">
        {children}
      </div>
    </div>
  );
}

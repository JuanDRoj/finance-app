import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Our own `@theme` tokens (globals.css) that tailwind-merge cannot tell apart from other groups.
// Without them it reads `text-brand` as a text *color* and drops it next to `text-primary`
// (the Kanza name needs both). Add a token here whenever it is a font size, tracking, radius or
// shadow that is not one of Tailwind's own names. Colors need nothing: any other `text-*` name is
// a color.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "brand",
        "brand-compact",
        "title-tablet",
        "title-desktop",
        "tooltip-label",
        "avatar",
        "nav-label",
        "item",
        "caption",
        "panel-title",
        "amount",
        "amount-symbol",
        "amount-panel",
        "amount-symbol-panel",
      ],
      tracking: ["brand", "title", "amount"],
      radius: ["tile", "icon", "field", "nav", "sheet", "tooltip", "card", "dialog"],
      shadow: ["tooltip", "nav", "fab", "panel", "dialog", "sheet"],
    },
  },
});

/** Combines class names and resolves Tailwind conflicts (the last one wins). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

import { focusRing } from "@/components/ui/focus";

/**
 * The look of a control of the filters card on desktop (K-V2-Escritorio, "movimientos"): a pill of
 * 42 px (44 for a finger), a border from `--input` (the border of a control must reach 3:1), a solid
 * `surface` fill, Karla 15 px in bold. With a finger (`pointer: coarse`, a tablet in landscape reaches
 * 1024 px) the text is 16 px: `text-item` is a utility, so it beats the base rule of `globals.css`
 * that sets 16 px on every `input`, `textarea` and `select`, and iOS zooms into a field under 16 px
 * when it is focused. The month select wears it; the search box and the account and
 * category selects of FE-33 are meant to wear it too, so the card stays one row of equal controls.
 * Native controls under it: it only dresses them, it does not replace them.
 */
export const FILTER_PILL = [
  "h-10.5 rounded-full border border-input bg-surface text-item font-bold text-foreground",
  "pointer-coarse:h-11 pointer-coarse:text-base",
  focusRing,
].join(" ");

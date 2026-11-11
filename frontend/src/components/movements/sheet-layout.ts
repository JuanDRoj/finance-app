// What the two sheets of a movement share ("Registrar movimiento", `MovementSheet`, and "Editar
// movimiento", `MovementEditSheet`): the shape of the tall bottom sheet and where the focus starts.
// A module of its own so that the edit sheet does not pull the other one into its bundle.

/**
 * Below 1024 px the sheet is tall (36 px from the top, or the safe area plus 8 px, which is more),
 * so the category and the account stay in view above the keyboard (docs/diseno.md D19). It is
 * placed by `top` and `bottom`, not by a height, so lifting the bottom for the keyboard shrinks it.
 * From 768 px it is centered and at most 640 px wide (the canvas has no tablet).
 */
export const TALL_SHEET =
  "top-[max(2.25rem,calc(env(safe-area-inset-top,0px)+0.5rem))] max-h-none md:mx-auto md:max-w-160";

/** The amount, where the focus starts when the form is already there as the sheet opens. */
export function startOnTheAmount(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    "[data-slot='sheet-content'] input[inputmode='decimal']",
  );
}

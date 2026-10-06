/**
 * Visible focus for every control (docs/diseno.md D14): a solid `ring` outline, 2 px, set off from
 * the control so it stays visible on top of a filled button. The base layer of globals.css only
 * sets the outline color; the width and offset come from here.
 *
 * `focusRing` is what components use (keyboard focus only). `focusRingForced` is the same look
 * without waiting for focus: the component catalog applies it to show the "focus" state.
 */
export const focusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export const focusRingForced = "outline-2 outline-offset-2 outline-ring";

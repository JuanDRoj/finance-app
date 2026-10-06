/**
 * Visible focus for every control (docs/diseno.md D14): a solid `ring` outline, 2 px, set off from
 * the control so it stays visible on top of a filled button. The base layer of globals.css only
 * sets the outline color; the width and offset come from here.
 *
 * Never add `outline-none` / `outline-hidden` to a control: in Tailwind v4 they set
 * `--tw-outline-style: none`, and `outline-2` takes its style from that variable, so the ring
 * would not paint at all. `outline-solid` states the style explicitly. (focus.test.ts guards it.)
 *
 * `focusRing` is what components use (keyboard focus only). `focusRingForced` is the same look
 * without waiting for focus: the component catalog applies it to show the "focus" state.
 */
export const focusRing =
  "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export const focusRingForced = "outline-solid outline-2 outline-offset-2 outline-ring";

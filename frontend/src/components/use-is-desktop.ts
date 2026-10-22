import { useSyncExternalStore } from "react";

/**
 * The same width as Tailwind's `lg` (64rem = 1024 px at the default font size), where the sidebar
 * appears and the bottom bar goes away (`AppShell`, docs/diseno.md D17). Sonner takes its position
 * as a prop, not from CSS, and `/mas` redirects from this width, so both ask the browser with
 * `matchMedia`; keep it equal to the `lg:` classes. It is the only place that states it.
 */
export const DESKTOP_MEDIA_QUERY = "(min-width: 64rem)";

function subscribeToDesktop(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_MEDIA_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the window is as wide as the desktop layout. On the server, and while hydrating, it is
 * `false` (the phone layout): React then re-renders with the real value, with no mismatch. Use it
 * only for what CSS cannot do (a prop of a library, a redirect): the layout itself switches with
 * `lg:` classes, so nothing flashes.
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeToDesktop,
    () => window.matchMedia(DESKTOP_MEDIA_QUERY).matches,
    () => false,
  );
}

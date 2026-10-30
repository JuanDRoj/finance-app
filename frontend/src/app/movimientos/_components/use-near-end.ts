"use client";

import { useEffect, useRef, type RefObject } from "react";
import { DESKTOP_MEDIA_QUERY } from "@/components/use-is-desktop";

/** How far below the screen the sentinel starts the next page: about a screen of rows of a phone. */
const ROOT_MARGIN = "600px 0px";

/**
 * Calls `onNearEnd` when the element behind the returned `ref` (the sentinel under the last row of a
 * phone) comes within a screen of the viewport. It is the "scroll infinito" of Movimientos (D19), which
 * is only for a phone: the width is asked **at the moment it fires** (`matchMedia`, like `AccountLink`
 * does on a click), so a window that is widened to 1024 px stops loading pages by itself and "Cargar
 * más" takes over, with no `useIsDesktop` that would draw something else when it hydrates.
 *
 * - Off while `enabled` is false (no next page, one is on its way, the last one failed, the list is
 *   the one of the previous filters). An `IntersectionObserver` only reports a **change** of
 *   intersection, and a page that is still short leaves the sentinel inside the margin, so the
 *   observer is made again every time `enabled` comes back: that first report is what asks for
 *   the page after it.
 * - `onNearEnd` can change on every render without making the observer again.
 */
export function useNearEnd(
  onNearEnd: () => void,
  enabled: boolean,
): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  const latest = useRef(onNearEnd);
  useEffect(() => {
    latest.current = onNearEnd;
  });

  useEffect(() => {
    const node = ref.current;
    if (!enabled || !node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (window.matchMedia(DESKTOP_MEDIA_QUERY).matches) return;
        latest.current();
      },
      { rootMargin: ROOT_MARGIN },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled]);

  return ref;
}

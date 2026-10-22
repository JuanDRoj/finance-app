"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useIsDesktop } from "@/components/use-is-desktop";

/**
 * Sends the visitor away from a screen that only exists below 1024 px ("Más", docs/diseno.md D17
 * › Navegación del Hito 1), because on desktop its options are already in the sidebar. A Server
 * Component cannot know the width, so it is the browser that asks; the page hides its content
 * with `lg:hidden` meanwhile. `replace`, so "atrás" does not come back to a screen that bounces.
 * It also reacts when the window grows past 1024 px (a tablet turned sideways).
 */
export function DesktopRedirect({ to = "/" }: Readonly<{ to?: string }>) {
  const router = useRouter();
  const desktop = useIsDesktop();

  useEffect(() => {
    if (desktop) router.replace(to);
  }, [desktop, router, to]);

  return null;
}

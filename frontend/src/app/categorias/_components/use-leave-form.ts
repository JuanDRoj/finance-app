"use client";

import { useRouter } from "next/navigation";
import { canGoBackInApp } from "@/components/back-navigation";

/**
 * How the page of a category form (`/categorias/nueva`, `/categorias/[id]`; below 1024 px) leaves
 * once it did its job, as `NewAccountPageForm` does.
 *
 * - **Came from the app** (`canGoBackInApp`, the rule of "Volver"): `router.refresh()` and then
 *   `router.back()`. The history returns to the list instead of growing, and "atrás" does not come
 *   back to a form that already did its job. Next.js reuses a cached page on back/forward whatever
 *   its age, so the refresh goes first: it bumps the version of that cache, which makes the list
 *   behind unusable, and going back asks the server for it again.
 * - **Opened directly** (nothing in this app to go back to): `router.replace("/categorias")`, a
 *   regular navigation to a dynamic page, which is never served from the cache.
 */
export function useLeaveForm(): () => void {
  const router = useRouter();
  return function leave() {
    if (canGoBackInApp()) {
      router.refresh();
      router.back();
    } else {
      router.replace("/categorias");
    }
  };
}

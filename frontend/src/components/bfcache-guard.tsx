"use client";

import { useEffect } from "react";

/**
 * Attribute that `markSessionEnded()` puts on `<html>`. `globals.css` hides the page while it is
 * set. It lives in the DOM of the page that was left, so it travels with it into the browser's
 * back/forward cache and a restored copy shows nothing (not even for the frame before the guard
 * reloads it).
 */
export const SESSION_ENDED_ATTRIBUTE = "data-session-ended";

/**
 * Called when the session ends (logout): from now on, this page must not show its data again,
 * however it comes back (a "back" that restores it from memory).
 */
export function markSessionEnded() {
  document.documentElement.setAttribute(SESSION_ENDED_ATTRIBUTE, "true");
}

/**
 * The last safety net of "after logout, back shows no data". A private page is dynamic, so Next
 * sends it with `Cache-Control: no-store`, and Chrome and Firefox do not keep such a page in the
 * back/forward cache. Where a page is restored from that cache anyway (`pageshow` with
 * `persisted`), it comes back frozen, exactly as it was left, without asking the server. Reloading
 * it asks the server again: without a cookie the proxy sends it to `/login`, with one it shows
 * fresh data. Renders nothing; `AppShell` mounts it, so every private screen has it.
 */
export function BfcacheGuard() {
  useEffect(() => {
    function reloadWhenRestored(event: PageTransitionEvent) {
      if (event.persisted) window.location.reload();
    }
    window.addEventListener("pageshow", reloadWhenRestored);
    return () => window.removeEventListener("pageshow", reloadWhenRestored);
  }, []);

  return null;
}

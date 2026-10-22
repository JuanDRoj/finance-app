import { act, cleanup, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "./sonner";

// docs/diseno.md D8 and D17: the toast is at the bottom and centered below 1024 px, and at the
// bottom right from 1024 px (so the sidebar, on the left, never covers it). Sonner takes the
// position as a prop, so the Toaster asks the browser for the width with `matchMedia`. Below
// 1024 px a screen with the bottom bar raises it above the bar (KAN-69).
const DESKTOP_QUERY = "(min-width: 64rem)";

/**
 * A `matchMedia` for jsdom (which has none) where only the desktop query can match. Sonner asks
 * for `prefers-color-scheme` too (the theme is "system"), so listeners are kept per query.
 */
function stubMatchMedia(initiallyDesktop: boolean) {
  let desktop = initiallyDesktop;
  const listeners = new Map<string, Set<(event: { matches: boolean }) => void>>();
  const listenersOf = (query: string) => {
    if (!listeners.has(query)) listeners.set(query, new Set());
    return listeners.get(query)!;
  };
  vi.stubGlobal("matchMedia", (query: string) => ({
    media: query,
    get matches() {
      return query === DESKTOP_QUERY && desktop;
    },
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) =>
      listenersOf(query).add(listener),
    removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) =>
      listenersOf(query).delete(listener),
  }));
  return {
    resize(toDesktop: boolean) {
      desktop = toDesktop;
      for (const listener of listenersOf(DESKTOP_QUERY)) listener({ matches: toDesktop });
    },
    desktopListeners: () => listenersOf(DESKTOP_QUERY).size,
  };
}

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  cleanup();
  vi.unstubAllGlobals();
});

async function showToast() {
  render(<Toaster />);
  act(() => {
    toast("Guardado");
  });
  await screen.findByText("Guardado");
  const toaster = document.querySelector("[data-sonner-toaster]");
  expect(toaster).not.toBeNull();
  return toaster as HTMLElement;
}

describe("Toaster position", () => {
  it("is bottom center below 1024 px", async () => {
    stubMatchMedia(false);
    const toaster = await showToast();
    expect(toaster.getAttribute("data-y-position")).toBe("bottom");
    expect(toaster.getAttribute("data-x-position")).toBe("center");
  });

  it("is bottom right from 1024 px", async () => {
    stubMatchMedia(true);
    const toaster = await showToast();
    expect(toaster.getAttribute("data-y-position")).toBe("bottom");
    expect(toaster.getAttribute("data-x-position")).toBe("right");
  });

  it("follows the window when it crosses 1024 px", async () => {
    const media = stubMatchMedia(false);
    const toaster = await showToast();
    expect(toaster.getAttribute("data-x-position")).toBe("center");

    act(() => media.resize(true));
    expect(document.querySelector("[data-sonner-toaster]")?.getAttribute("data-x-position")).toBe(
      "right",
    );

    act(() => media.resize(false));
    expect(document.querySelector("[data-sonner-toaster]")?.getAttribute("data-x-position")).toBe(
      "center",
    );
  });

  it("stops listening to the window when it unmounts", () => {
    const media = stubMatchMedia(false);
    const { unmount } = render(<Toaster />);
    expect(media.desktopListeners()).toBe(1);
    unmount();
    expect(media.desktopListeners()).toBe(0);
  });
});

describe("Toaster offset from the bottom", () => {
  // `globals.css` defines `--toast-offset-bottom` on the body only when the page has the bottom bar
  // (`tokens.test.ts` reads that rule). Without it, the fallback is the base offset of D8.
  const BELOW_BAR = "var(--toast-offset-bottom, calc(16px + env(safe-area-inset-bottom, 0px)))";

  it("below 1024 px reads the bar's variable, with the base offset (16px + safe area) as fallback", async () => {
    stubMatchMedia(false);
    const toaster = await showToast();
    expect(toaster.style.getPropertyValue("--offset-bottom")).toBe(BELOW_BAR);
    // Sonner uses the mobile offset under 600 px and the other one above: both must raise it.
    expect(toaster.style.getPropertyValue("--mobile-offset-bottom")).toBe(BELOW_BAR);
  });

  it("keeps the 16 px gutters at the sides below 1024 px", async () => {
    stubMatchMedia(false);
    const toaster = await showToast();
    expect(toaster.style.getPropertyValue("--offset-left")).toBe("16px");
    expect(toaster.style.getPropertyValue("--offset-right")).toBe("16px");
  });

  it("from 1024 px sits 24 px (plus the safe area) from the bottom and the right, not over a bar", async () => {
    stubMatchMedia(true);
    const toaster = await showToast();
    expect(toaster.style.getPropertyValue("--offset-bottom")).toBe(
      "calc(24px + env(safe-area-inset-bottom, 0px))",
    );
    expect(toaster.style.getPropertyValue("--offset-right")).toBe(
      "calc(24px + env(safe-area-inset-right, 0px))",
    );
  });
});

import { act, cleanup, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "./sonner";

// docs/diseno.md D8 and D17: the toast is at the bottom and centered below 1024 px, and at the
// bottom right from 1024 px (so the sidebar, on the left, never covers it). Sonner takes the
// position as a prop, so the Toaster asks the browser for the width with `matchMedia`.
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

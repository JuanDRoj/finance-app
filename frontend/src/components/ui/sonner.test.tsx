import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

describe("Toaster as a region for the keyboard and assistive technology (FE-23)", () => {
  it("is named in Spanish with the hotkey that takes the focus to it", async () => {
    stubMatchMedia(true);
    await showToast();
    const region = document.querySelector("section[aria-label]") as HTMLElement;
    expect(region.getAttribute("aria-label")).toBe("Notificaciones alt+T");
    expect(region.getAttribute("aria-live")).toBe("polite");
  });

  it("Alt+T takes the focus to the toasts, where 'Deshacer' is a button that Enter presses", async () => {
    stubMatchMedia(true);
    render(<Toaster />);
    const undo = vi.fn();
    act(() => {
      toast.success("Eliminaste «Café»", { action: { label: "Deshacer", onClick: undo } });
    });
    await screen.findByText("Eliminaste «Café»");
    const action = screen.getByRole("button", { name: "Deshacer" });
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { code: "KeyT", altKey: true, bubbles: true }),
      );
    });
    const region = document.querySelector("section[aria-label]") as HTMLElement;
    expect(region.querySelector("ol")?.contains(document.activeElement)).toBe(true);
    // The action is a real button: Tab reaches it and Enter or Space press it like a click.
    expect(action.tagName).toBe("BUTTON");
    action.focus();
    fireEvent.click(action);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("the action has the 44 px and the focus ring of the project", async () => {
    stubMatchMedia(true);
    render(<Toaster />);
    act(() => {
      toast.success("Eliminaste «Café»", { action: { label: "Deshacer", onClick: () => {} } });
    });
    await screen.findByText("Eliminaste «Café»");
    // Sonner's own styles are unlayered, so the classes carry `!` (see `sonner.tsx`).
    const className = screen.getByRole("button", { name: "Deshacer" }).className;
    expect(className).toContain("h-11!");
    expect(className).toContain("focus-visible:outline-ring");
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

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrimaryActionLink } from "./primary-action-link";

// `next/link` navigates through the app router, which a test does not have: a plain anchor stands
// in. What is under test is what the link decides on a click, not Next's navigation.
vi.mock("next/link", () => ({
  default: ({ prefetch, ...props }: ComponentProps<"a"> & { prefetch?: boolean }) => (
    <a data-prefetch={String(prefetch)} {...props} />
  ),
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

/** `matchMedia` as a browser of that width answers it. */
function atWidth(desktop: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: desktop && query === "(min-width: 64rem)" })),
  );
}

beforeEach(() => atWidth(true));

const PANEL = { param: "cuenta", value: "nueva" };

function renderLink(props: Partial<ComponentProps<typeof PrimaryActionLink>> = {}) {
  return render(
    <PrimaryActionLink href="/cuentas/nueva" panel={PANEL} {...props}>
      Nueva cuenta
    </PrimaryActionLink>,
  );
}

/**
 * Clicks and says whether the browser would have followed the link. The listener on the document
 * sees the click after the component did, notes whether it was still going to navigate, and then
 * stops it (jsdom cannot navigate).
 */
function click(init: Parameters<typeof fireEvent.click>[1] = {}) {
  const link = screen.getByRole("link", { name: "Nueva cuenta" });
  let followed = false;
  const listener = (event: Event) => {
    followed = !event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener("click", listener);
  fireEvent.click(link, init);
  document.removeEventListener("click", listener);
  return followed;
}

describe("PrimaryActionLink", () => {
  it("is a real link to the page of the action, named by its text", () => {
    renderLink();
    const link = screen.getByRole("link", { name: "Nueva cuenta" });
    expect(link.getAttribute("href")).toBe("/cuentas/nueva");
  });

  it("does not prefetch a page that a desktop never visits", () => {
    renderLink();
    expect(screen.getByRole("link").getAttribute("data-prefetch")).toBe("false");
  });

  it("from 1024 px opens the panel over the screen instead of navigating", () => {
    window.history.replaceState(null, "", "/?mes=2026-10");
    renderLink();
    expect(click()).toBe(false); // the component prevented the navigation
    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("?mes=2026-10&cuenta=nueva");
  });

  it("below 1024 px lets the link navigate to its page, and leaves the URL alone", () => {
    atWidth(false);
    renderLink();
    expect(click()).toBe(true);
    expect(window.location.search).toBe("");
  });

  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Cmd", { metaKey: true }],
    ["Shift", { shiftKey: true }],
    ["Alt", { altKey: true }],
    ["the middle button", { button: 1 }],
  ])("keeps its normal meaning with %s (a new tab, a window): no panel", (_name, init) => {
    renderLink();
    expect(click(init)).toBe(true);
    expect(window.location.search).toBe("");
  });

  it("is a plain link without a panel, at any width", () => {
    renderLink({ panel: undefined });
    expect(click()).toBe(true);
    expect(window.location.search).toBe("");
  });

  it("calls the onClick it is given first, and respects a click that was already handled", () => {
    const onClick = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    renderLink({ onClick });
    expect(click()).toBe(false);
    expect(onClick).toHaveBeenCalledTimes(1);
    // The caller took the click: the panel is not opened on top of it.
    expect(window.location.search).toBe("");
  });

  it("passes the class and the content on", () => {
    renderLink({ className: "boton" });
    expect(screen.getByRole("link").className).toBe("boton");
    expect(screen.getByRole("link").textContent).toBe("Nueva cuenta");
  });
});

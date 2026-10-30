import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MovementsHeaderActions } from "./movements-header-actions";

// The magnifier reads the search from the URL.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const MONTH = "2026-10";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("MovementsHeaderActions", () => {
  it("is the pill 'Registrar movimiento': a link to the page that opens the sheet", () => {
    render(<MovementsHeaderActions currentMonth={MONTH} />);
    const link = screen.getByRole("link", { name: "Registrar movimiento" });
    expect(link.getAttribute("href")).toBe("/?movimiento=nuevo");
  });

  it("is there from 1024 px only, 46 px tall, in primary", () => {
    render(<MovementsHeaderActions currentMonth={MONTH} />);
    const classes = screen.getByRole("link").className;
    for (const cls of ["hidden", "lg:inline-flex", "h-11.5", "rounded-full", "bg-primary"]) {
      expect(classes).toContain(cls);
    }
  });

  it("has the magnifier for a phone and the pill for desktop, and nothing else that does nothing", () => {
    const { container } = render(<MovementsHeaderActions currentMonth={MONTH} />);
    const controls = container.querySelectorAll("a, button");
    expect(controls).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Buscar" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Registrar movimiento" })).toBeTruthy();
  });

  it("puts the magnifier first and shows it below 1024 px only", () => {
    const { container } = render(<MovementsHeaderActions currentMonth={MONTH} />);
    expect(container.firstElementChild!.tagName).toBe("BUTTON");
    expect(container.firstElementChild!.className).toContain("lg:hidden");
  });

  it("keeps the magnifier when there is no main action at all", () => {
    render(<MovementsHeaderActions noAccounts currentMonth={MONTH} />);
    expect(screen.getByRole("button", { name: "Buscar" })).toBeTruthy();
  });

  it("opens the sheet over the screen with the URL of the main action", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query }));
    render(<MovementsHeaderActions currentMonth={MONTH} />);
    fireEvent.click(screen.getByRole("link", { name: "Registrar movimiento" }));
    expect(window.location.search).toBe("?movimiento=nuevo");
  });

  it("says 'Nueva cuenta' and opens that form when there is no active account", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query }));
    render(<MovementsHeaderActions noAccounts currentMonth={MONTH} />);
    expect(screen.queryByRole("link", { name: "Registrar movimiento" })).toBeNull();
    const link = screen.getByRole("link", { name: "Nueva cuenta" });
    expect(link.getAttribute("href")).toBe("/cuentas/nueva");
    fireEvent.click(link);
    expect(window.location.search).toBe("?cuenta=nueva");
  });
});

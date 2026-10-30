import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MovementsHeaderActions } from "./movements-header-actions";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("MovementsHeaderActions", () => {
  it("is the pill 'Registrar movimiento': a link to the page that opens the sheet", () => {
    render(<MovementsHeaderActions />);
    const link = screen.getByRole("link", { name: "Registrar movimiento" });
    expect(link.getAttribute("href")).toBe("/?movimiento=nuevo");
  });

  it("is there from 1024 px only, 46 px tall, in primary", () => {
    render(<MovementsHeaderActions />);
    const classes = screen.getByRole("link").className;
    for (const cls of ["hidden", "lg:inline-flex", "h-11.5", "rounded-full", "bg-primary"]) {
      expect(classes).toContain(cls);
    }
  });

  it("is the only thing in the header on a phone's side: no button that does nothing", () => {
    const { container } = render(<MovementsHeaderActions />);
    expect(container.querySelectorAll("a, button")).toHaveLength(1);
  });

  it("opens the sheet over the screen with the URL of the main action", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query }));
    render(<MovementsHeaderActions />);
    fireEvent.click(screen.getByRole("link", { name: "Registrar movimiento" }));
    expect(window.location.search).toBe("?movimiento=nuevo");
  });

  it("says 'Nueva cuenta' and opens that form when there is no active account", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query }));
    render(<MovementsHeaderActions noAccounts />);
    expect(screen.queryByRole("link", { name: "Registrar movimiento" })).toBeNull();
    const link = screen.getByRole("link", { name: "Nueva cuenta" });
    expect(link.getAttribute("href")).toBe("/cuentas/nueva");
    fireEvent.click(link);
    expect(window.location.search).toBe("?cuenta=nueva");
  });
});

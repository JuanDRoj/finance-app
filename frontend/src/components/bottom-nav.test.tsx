import { cleanup, render, screen } from "@testing-library/react";
import { House, ListBullets, Tag, Wallet } from "@phosphor-icons/react/ssr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNav, BottomNavBar } from "./bottom-nav";
import type { NavConfig } from "./nav-sections";

const mocks = vi.hoisted(() => ({ pathname: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: mocks.pathname }));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

beforeEach(() => {
  mocks.pathname.mockReset().mockReturnValue("/");
});

// The end of Hito 1. The app's own list has only Inicio until the other screens exist.
const FULL: NavConfig = {
  sections: [
    { id: "home", href: "/", label: "Inicio", icon: House },
    { id: "transactions", href: "/movimientos", label: "Movimientos", icon: ListBullets },
    { id: "accounts", href: "/cuentas", label: "Cuentas", icon: Wallet },
  ],
  more: [
    {
      id: "categories",
      href: "/categorias",
      label: "Categorías",
      icon: Tag,
      description: "Crea, renombra y archiva las tuyas",
    },
  ],
  action: { href: "/cuentas/nueva", label: "Nueva cuenta", buttonText: "Nueva cuenta" },
};

function renderBar(nav: NavConfig, pathname = "/") {
  return render(<BottomNavBar nav={nav} pathname={pathname} />);
}

/** The names of the links in the order they are on the bar (the "+" by its `aria-label`). */
function linkNames() {
  return screen
    .getAllByRole("link")
    .map((link) => link.getAttribute("aria-label") ?? link.textContent);
}

describe("BottomNavBar", () => {
  it("is the main navigation", () => {
    renderBar(FULL);
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeTruthy();
  });

  it("shows Inicio · Movimientos · + · Cuentas · Más, with the + in the middle", () => {
    renderBar(FULL);
    expect(linkNames()).toEqual(["Inicio", "Movimientos", "Nueva cuenta", "Cuentas", "Más"]);
  });

  it("names the + by its action, not by an icon", () => {
    renderBar(FULL);
    const plus = screen.getByRole("link", { name: "Nueva cuenta" });
    expect(plus.getAttribute("href")).toBe("/cuentas/nueva");
    expect(plus.textContent).toBe("");
    expect(plus.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("follows the name of the action when it changes (FE-20: Registrar movimiento)", () => {
    renderBar({
      ...FULL,
      action: { href: "/x", label: "Registrar movimiento", buttonText: "Registrar" },
    });
    expect(screen.getByRole("link", { name: "Registrar movimiento" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Nueva cuenta" })).toBeNull();
  });

  it("draws no + while there is no action", () => {
    renderBar({ ...FULL, action: null });
    expect(linkNames()).toEqual(["Inicio", "Movimientos", "Cuentas", "Más"]);
  });

  it("draws no Más tab while nothing hangs from it, and links it to /mas when something does", () => {
    const { unmount } = renderBar({ ...FULL, more: [] });
    expect(screen.queryByRole("link", { name: "Más" })).toBeNull();
    unmount();

    renderBar(FULL);
    expect(screen.getByRole("link", { name: "Más" }).getAttribute("href")).toBe("/mas");
  });

  it("shows only what exists today: Inicio alone", () => {
    renderBar({ sections: [FULL.sections[0]!], more: [], action: null });
    expect(linkNames()).toEqual(["Inicio"]);
  });

  it("marks the current tab with aria-current, and only that one", () => {
    renderBar(FULL, "/cuentas");
    const current = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.textContent)).toEqual(["Cuentas"]);
  });

  it("marks the tab of a screen below a section (whole segments)", () => {
    renderBar(FULL, "/movimientos/abc");
    expect(screen.getByRole("link", { name: "Movimientos" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "Inicio" }).getAttribute("aria-current")).toBeNull();
  });

  it("keeps Más current on its own screen and on the screens that hang from it", () => {
    for (const pathname of ["/mas", "/categorias", "/categorias/abc"]) {
      const { unmount } = renderBar(FULL, pathname);
      expect(screen.getByRole("link", { name: "Más" }).getAttribute("aria-current")).toBe("page");
      expect(screen.getByRole("link", { name: "Cuentas" }).getAttribute("aria-current")).toBeNull();
      unmount();
    }
  });

  it("marks nothing on a path outside the tabs", () => {
    renderBar(FULL, "/catalog");
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("aria-current")).toBeNull();
    }
  });

  it("makes the current label bold (700) and the rest semibold (600), 11 px", () => {
    renderBar(FULL, "/cuentas");
    const active = screen.getByRole("link", { name: "Cuentas" });
    const idle = screen.getByRole("link", { name: "Inicio" });
    expect(active.className).toContain("font-bold");
    expect(idle.className).toContain("font-semibold");
    for (const link of [active, idle]) {
      expect(link.className).toContain("text-nav-label");
      expect(link.className).toContain("md:text-xs");
    }
  });

  it("gives every tab at least 64 x 52 px and the + 52 px (the canvas)", () => {
    renderBar(FULL);
    for (const name of ["Inicio", "Movimientos", "Cuentas", "Más"]) {
      const classes = screen.getByRole("link", { name }).className;
      expect(classes).toContain("min-w-16");
      expect(classes).toContain("min-h-13");
    }
    expect(screen.getByRole("link", { name: "Nueva cuenta" }).className).toContain("size-13");
  });

  it("holds a long label without failing", () => {
    const long = "Una sección con un nombre larguísimo";
    renderBar({ ...FULL, sections: [{ id: "x", href: "/x", label: long, icon: House }] });
    expect(screen.getByRole("link", { name: long })).toBeTruthy();
  });
});

describe("BottomNav", () => {
  it("is the app's bar: pinned, gone from 1024 px, and findable by its slot", () => {
    mocks.pathname.mockReturnValue("/");
    render(<BottomNav />);
    const nav = screen.getByRole("navigation", { name: "Principal" });
    expect(nav.getAttribute("data-slot")).toBe("bottom-nav");
    expect(nav.className).toContain("fixed");
    expect(nav.className).toContain("lg:hidden");
    // Today it has Inicio (the current screen), the "+" (since KAN-70 the main action opens the
    // form of a new account) and Cuentas (KAN-71).
    expect(
      screen
        .getAllByRole("link")
        .map((link) => link.getAttribute("aria-label") ?? link.textContent),
    ).toEqual(["Inicio", "Nueva cuenta", "Cuentas"]);
    expect(screen.getByRole("link", { name: "Inicio" }).getAttribute("aria-current")).toBe("page");
  });

  it("leads the '+' to the page of the form of a new account: a phone has no side panel", () => {
    render(<BottomNav />);
    const plus = screen.getByRole("link", { name: "Nueva cuenta" });
    expect(plus.getAttribute("href")).toBe("/cuentas/nueva");
    expect(plus.textContent).toBe("");
    expect(plus.className).toContain("size-13");
  });

  it("clears the safe areas: the bottom edge and the sides", () => {
    render(<BottomNav />);
    const classes = screen.getByRole("navigation", { name: "Principal" }).className;
    expect(classes).toContain("bottom-(--bottom-nav-offset)");
    expect(classes).toContain("left-[max(0.75rem,env(safe-area-inset-left,0px))]");
    expect(classes).toContain("right-[max(0.75rem,env(safe-area-inset-right,0px))]");
  });
});

import { cleanup, render, screen } from "@testing-library/react";
import { House, ListBullets, Tag, Wallet } from "@phosphor-icons/react/ssr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NavConfig } from "./nav-sections";
import { SidebarNav } from "./sidebar-nav";

// `usePathname` is the only thing of the router the nav reads.
const mocks = vi.hoisted(() => ({ pathname: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: mocks.pathname }));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

beforeEach(() => {
  mocks.pathname.mockReset().mockReturnValue("/");
});

// The end of Hito 1: the real list has only Inicio until the other screens exist.
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
  action: null,
};

describe("SidebarNav (the app's own list)", () => {
  it("is the main navigation, with a link per section named by its visible text", () => {
    render(<SidebarNav group="main" />);
    const nav = screen.getByRole("navigation", { name: "Principal" });
    expect(nav.querySelectorAll("a")).toHaveLength(1);
    const link = screen.getByRole("link", { name: "Inicio" });
    expect(link.getAttribute("href")).toBe("/");
    // The text names the link: an `aria-label` would hide it from speech recognition (WCAG 2.5.3).
    expect(link.getAttribute("aria-label")).toBeNull();
    expect(link.textContent).toBe("Inicio");
  });

  it("marks the current section with aria-current and a filled icon", () => {
    render(<SidebarNav group="main" />);
    const link = screen.getByRole("link", { name: "Inicio" });
    expect(link.getAttribute("aria-current")).toBe("page");
    // The current section does not rely on color: its name is bold (and its icon is filled, a
    // different Phosphor path, which a class cannot show).
    expect(link.className).toContain("font-bold");
  });

  it("marks no section on a path outside the sections", () => {
    mocks.pathname.mockReturnValue("/catalog");
    render(<SidebarNav group="main" />);
    const link = screen.getByRole("link", { name: "Inicio" });
    expect(link.getAttribute("aria-current")).toBeNull();
    expect(link.className).not.toContain("font-bold");
  });

  it("hides the icon from assistive technology: the text names the link", () => {
    render(<SidebarNav group="main" />);
    const link = screen.getByRole("link", { name: "Inicio" });
    expect(link.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws nothing for the bottom group while nothing hangs from Más", () => {
    const { container } = render(<SidebarNav group="more" />);
    expect(container.innerHTML).toBe("");
  });

  it("has no tooltip: the name is visible", () => {
    render(<SidebarNav group="main" />);
    expect(document.querySelector("[data-slot='tooltip-content']")).toBeNull();
  });

  it("is a link of at least 44 px, with the room the label needs", () => {
    render(<SidebarNav group="main" />);
    expect(screen.getByRole("link", { name: "Inicio" }).className).toContain("min-h-11");
  });
});

describe("SidebarNav (the whole Hito 1 navigation)", () => {
  it("lists the sections in order, and marks only the current one", () => {
    mocks.pathname.mockReturnValue("/cuentas/abc");
    render(<SidebarNav group="main" nav={FULL} />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Inicio", "Movimientos", "Cuentas"]);
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual([null, null, "page"]);
  });

  it("puts what hangs from Más in its own navigation, named 'Organiza'", () => {
    mocks.pathname.mockReturnValue("/categorias");
    render(<SidebarNav group="more" nav={FULL} />);
    const nav = screen.getByRole("navigation", { name: "Organiza" });
    const link = screen.getByRole("link", { name: "Categorías" });
    expect(nav.contains(link)).toBe(true);
    expect(link.getAttribute("href")).toBe("/categorias");
    expect(link.getAttribute("aria-current")).toBe("page");
  });

  it("takes the path from the preview when it is given, not from the router", () => {
    mocks.pathname.mockReturnValue("/");
    render(<SidebarNav group="main" nav={FULL} pathname="/movimientos" />);
    expect(screen.getByRole("link", { name: "Movimientos" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "Inicio" }).getAttribute("aria-current")).toBeNull();
  });

  it("holds a very long name without failing", () => {
    const long = "Una sección con un nombre larguísimo ".repeat(5).trim();
    render(
      <SidebarNav
        group="main"
        nav={{ ...FULL, sections: [{ id: "x", href: "/x", label: long, icon: House }] }}
      />,
    );
    expect(screen.getByRole("link", { name: long })).toBeTruthy();
  });
});

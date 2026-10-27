import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NEW_ACCOUNT_ACTION, type NavConfig } from "./nav-sections";
import { Sidebar, SidebarBody } from "./sidebar";

// The client islands have their own tests; here only what the sidebar hands them matters, and what
// it draws itself: the logo, the space, the main action and the order of everything.
const mocks = vi.hoisted(() => ({ userMenu: vi.fn(), sidebarNav: vi.fn() }));

vi.mock("./brand/brand-font", () => ({ brandFont: { variable: "brand-font-variable" } }));
vi.mock("./user-menu", () => ({
  UserMenu: (props: unknown) => {
    mocks.userMenu(props);
    return <div data-testid="user-menu" />;
  },
}));
vi.mock("./sidebar-nav", () => ({
  SidebarNav: (props: { group: string }) => {
    mocks.sidebarNav(props);
    return <nav data-testid={`nav-${props.group}`} />;
  },
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

beforeEach(() => {
  mocks.userMenu.mockReset();
  mocks.sidebarNav.mockReset();
});

const USER = { name: "Ana Pérez", email: "ana@example.com", initials: "AP" };
const SPACE = { name: "Mi espacio", currency: { code: "UYU" } };
const WITH_ACTION: NavConfig = {
  sections: [],
  more: [],
  action: {
    href: "/cuentas/nueva",
    label: "Nueva cuenta",
    buttonText: "Nueva cuenta",
    panel: { param: "cuenta", value: "nueva" },
  },
};
const WITHOUT_ACTION: NavConfig = { sections: [], more: [], action: null };

describe("SidebarBody", () => {
  it("shows the Kanza name next to a decorative icon", () => {
    const { container } = render(<SidebarBody user={USER} space={SPACE} />);
    expect(screen.getByText("Kanza")).toBeTruthy();
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
    expect(container.querySelector("a[href='/']")).toBeNull();
  });

  describe("the space", () => {
    it("shows its initial, its name and its currency in Spanish", () => {
      render(<SidebarBody user={USER} space={SPACE} />);
      expect(screen.getByText("M")).toBeTruthy();
      expect(screen.getByText("Mi espacio")).toBeTruthy();
      expect(screen.getByText("Peso uruguayo · UYU")).toBeTruthy();
    });

    it("writes the currency at 13 px (the minimum), with the secondary-text token", () => {
      render(<SidebarBody space={SPACE} />);
      expect(screen.getByText("Peso uruguayo · UYU").className).toContain("text-caption");
    });

    it("is not interactive (one space in v1): no link, no button", () => {
      render(<SidebarBody space={SPACE} />);
      const row = screen.getByText("Mi espacio").closest("div");
      expect(row?.querySelector("a, button")).toBeNull();
    });

    it("shows the code alone for a currency with no name, never an English or raw value", () => {
      render(<SidebarBody space={{ name: "Casa", currency: { code: "XYZ" } }} />);
      expect(screen.getByText("XYZ")).toBeTruthy();
      expect(screen.queryByText(/personal|household/)).toBeNull();
    });

    it("is left out when the screen could not load the spaces", () => {
      render(<SidebarBody user={USER} />);
      expect(screen.queryByText("Mi espacio")).toBeNull();
      // Everything else stays: the account menu is never optional.
      expect(screen.getByTestId("user-menu")).toBeTruthy();
    });

    it("holds a very long name without failing", () => {
      const long = "x".repeat(150);
      render(<SidebarBody space={{ name: long, currency: { code: "UYU" } }} />);
      expect(screen.getByText(long).className).toContain("truncate");
    });
  });

  describe("the main action", () => {
    it("is not drawn while there is no destination", () => {
      render(<SidebarBody user={USER} space={SPACE} nav={WITHOUT_ACTION} />);
      expect(screen.queryByRole("link")).toBeNull();
    });

    it("is drawn with the real navigation: 'Registrar', which opens the sheet over the screen", () => {
      render(<SidebarBody user={USER} space={SPACE} />);
      const link = screen.getByRole("link", { name: "Registrar" });
      expect(link.getAttribute("href")).toBe("/?movimiento=nuevo");
      expect(screen.queryByRole("link", { name: "Nueva cuenta" })).toBeNull();
    });

    it("shows the key N as a decorative hint and announces it as a shortcut", () => {
      render(<SidebarBody user={USER} space={SPACE} />);
      const link = screen.getByRole("link", { name: "Registrar" });
      const hint = link.querySelector("span[aria-hidden='true']");
      expect(hint?.textContent).toBe("N");
      expect(link.getAttribute("aria-keyshortcuts")).toBe("N");
      // The hint is not part of the name (WCAG 2.5.3): the name is the visible word "Registrar".
      expect(link.getAttribute("aria-label")).toBeNull();
    });

    it("says 'Nueva cuenta', with no hint of a key, while the page knows there are no accounts", () => {
      render(<SidebarBody user={USER} space={SPACE} action={NEW_ACCOUNT_ACTION} />);
      const link = screen.getByRole("link", { name: "Nueva cuenta" });
      expect(link.getAttribute("href")).toBe("/cuentas/nueva");
      expect(link.getAttribute("aria-keyshortcuts")).toBeNull();
      expect(link.querySelector("span[aria-hidden='true']")).toBeNull();
      expect(link.textContent).toBe("Nueva cuenta");
      expect(screen.queryByRole("link", { name: "Registrar" })).toBeNull();
    });

    it("takes the action of its prop over the one of the config, and none draws no button", () => {
      const { rerender } = render(
        <SidebarBody user={USER} space={SPACE} nav={WITH_ACTION} action={null} />,
      );
      expect(screen.queryByRole("link")).toBeNull();
      rerender(
        <SidebarBody user={USER} space={SPACE} nav={WITHOUT_ACTION} action={NEW_ACCOUNT_ACTION} />,
      );
      expect(screen.getByRole("link", { name: "Nueva cuenta" })).toBeTruthy();
    });

    it("is a link named by its own text when there is one, without an aria-label", () => {
      render(<SidebarBody user={USER} space={SPACE} nav={WITH_ACTION} />);
      const link = screen.getByRole("link", { name: "Nueva cuenta" });
      expect(link.getAttribute("href")).toBe("/cuentas/nueva");
      expect(link.getAttribute("aria-label")).toBeNull();
      expect(link.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    });

    it("does not show a shortcut hint for an action that has no shortcut", () => {
      render(<SidebarBody user={USER} space={SPACE} nav={WITH_ACTION} />);
      expect(screen.getByRole("link", { name: "Nueva cuenta" }).textContent).toBe("Nueva cuenta");
    });
  });

  it("draws, in order: the logo, the space, the action, the sections, the bottom group, the account", () => {
    const { container } = render(<SidebarBody user={USER} space={SPACE} nav={WITH_ACTION} />);
    const order = [
      screen.getByText("Kanza"),
      screen.getByText("Mi espacio"),
      screen.getByRole("link", { name: "Nueva cuenta" }),
      screen.getByTestId("nav-main"),
      screen.getByTestId("nav-more"),
      screen.getByTestId("user-menu"),
    ];
    for (let index = 1; index < order.length; index++) {
      const previous = order[index - 1] as Node;
      const current = order[index] as Node;
      expect(
        previous.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING,
        `element ${index} follows element ${index - 1}`,
      ).toBeTruthy();
    }
    expect(container.querySelectorAll("nav")).toHaveLength(2);
  });

  it("gives the account menu the user and the sidebar placement", () => {
    render(<SidebarBody user={USER} space={SPACE} />);
    expect(mocks.userMenu).toHaveBeenCalledWith({ variant: "sidebar", user: USER });
  });

  it("hands the links only their group when it shows the app's own list", () => {
    render(<SidebarBody user={USER} space={SPACE} />);
    // No `nav` and no `pathname`: functions (icons) must not cross to a Client Component.
    expect(mocks.sidebarNav.mock.calls.map(([props]) => props)).toEqual([
      { group: "main", nav: undefined, pathname: undefined },
      { group: "more", nav: undefined, pathname: undefined },
    ]);
  });
});

describe("Sidebar", () => {
  it("is only for desktop: hidden below 1024 px, 240 px wide and 216 at the least", () => {
    render(<Sidebar user={USER} space={SPACE} />);
    const sidebar = document.querySelector("[data-slot='sidebar']");
    expect(sidebar).not.toBeNull();
    const classes = (sidebar as Element).className.split(/\s+/);
    for (const expected of ["hidden", "lg:block", "lg:w-60", "lg:min-w-54"]) {
      expect(classes, expected).toContain(expected);
    }
  });

  it("draws 'Registrar' by default and the action it is given instead (no accounts: 'Nueva cuenta')", () => {
    const { unmount } = render(<Sidebar user={USER} space={SPACE} />);
    expect(screen.getByRole("link", { name: "Registrar" })).toBeTruthy();
    unmount();
    render(<Sidebar user={USER} space={SPACE} action={NEW_ACCOUNT_ACTION} />);
    expect(screen.getByRole("link", { name: "Nueva cuenta" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Registrar" })).toBeNull();
  });

  it("keeps the card one screen tall and sticky, and scrolls inside if the window is low", () => {
    render(<Sidebar user={USER} space={SPACE} />);
    const card = document.querySelector("[data-slot='sidebar'] > div") as Element;
    expect(card.className).toContain("sticky");
    expect(card.className).toContain("100dvh");
    expect(card.className).toContain("overflow-y-auto");
    expect(card.className).toContain("bg-sidebar");
  });
});

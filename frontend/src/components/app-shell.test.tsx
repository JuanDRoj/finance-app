import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";
import { NEW_ACCOUNT_ACTION } from "./nav-sections";

// The shell's client pieces have their own tests (they need the router or a QueryClientProvider).
// Here: what the shell decides, which is where each piece goes and what it leaves out.
const mocks = vi.hoisted(() => ({
  userMenu: vi.fn(),
  sidebar: vi.fn(),
  bottomNav: vi.fn(),
  panelHost: vi.fn(),
  movementHost: vi.fn(),
}));

vi.mock("./user-menu", () => ({
  UserMenu: (props: { variant?: string; className?: string }) => {
    mocks.userMenu(props);
    return <button type="button" aria-label="Menú de la cuenta" className={props.className} />;
  },
}));
vi.mock("./sidebar", () => ({
  Sidebar: (props: unknown) => {
    mocks.sidebar(props);
    return <div data-slot="sidebar" />;
  },
}));
vi.mock("./bottom-nav", () => ({
  BottomNav: (props: unknown) => {
    mocks.bottomNav(props);
    return <nav data-slot="bottom-nav" aria-label="Principal" />;
  },
}));
vi.mock("./bfcache-guard", () => ({ BfcacheGuard: () => null }));
vi.mock("./accounts/account-panel", () => ({
  AccountPanelHost: (props: unknown) => {
    mocks.panelHost(props);
    return <div data-testid="panel-host" />;
  },
}));
vi.mock("./movements/movement-panel", () => ({
  MovementPanelHost: (props: unknown) => {
    mocks.movementHost(props);
    return <div data-testid="movement-host" />;
  },
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

beforeEach(() => {
  mocks.userMenu.mockReset();
  mocks.sidebar.mockReset();
  mocks.bottomNav.mockReset();
  mocks.panelHost.mockReset();
  mocks.movementHost.mockReset();
});

const USER = { display_name: "Ana Pérez", email: "ana@example.com" };
const SPACE = {
  id: "space-1",
  name: "Mi espacio",
  currency: { code: "UYU", exponent: 2 },
  timezone: "America/Montevideo",
};

describe("AppShell", () => {
  it("keeps the avatar in the header below 1024 px and hides it from there", () => {
    render(
      <AppShell title="Inicio" user={USER}>
        x
      </AppShell>,
    );
    const avatar = screen.getByRole("button", { name: "Menú de la cuenta" });
    expect(avatar.closest("header")).not.toBeNull();
    expect(avatar.className).toContain("lg:hidden");
  });

  it("hands the sidebar the user and the space, and only what the client needs of the user", () => {
    render(
      <AppShell title="Inicio" user={USER} space={SPACE}>
        x
      </AppShell>,
    );
    expect(mocks.sidebar).toHaveBeenCalledWith({
      user: { name: "Ana Pérez", email: "ana@example.com", initials: "AP" },
      space: SPACE,
    });
  });

  it("works without user and without space (a screen that could not load them)", () => {
    render(<AppShell title="Inicio">x</AppShell>);
    expect(mocks.sidebar).toHaveBeenCalledWith({ user: undefined, space: undefined });
    expect(screen.getByRole("button", { name: "Menú de la cuenta" })).toBeTruthy();
  });

  it("draws the bottom bar, and leaves room for it at the foot of the page", () => {
    render(<AppShell title="Inicio">x</AppShell>);
    expect(document.querySelector("[data-slot='bottom-nav']")).not.toBeNull();
    const main = screen.getByRole("main");
    expect(main.className).toContain("var(--bottom-nav-height)");
    expect(main.className).toContain("lg:pb-0");
  });

  it("leaves out the bottom bar when the screen asks (a form), and the room it needed", () => {
    render(
      <AppShell title="Nueva cuenta" hideBottomNav>
        x
      </AppShell>,
    );
    expect(document.querySelector("[data-slot='bottom-nav']")).toBeNull();
    expect(screen.getByRole("main").className).not.toContain("var(--bottom-nav-height)");
    // The sidebar stays on desktop, and so does the account menu.
    expect(document.querySelector("[data-slot='sidebar']")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Menú de la cuenta" })).toBeTruthy();
  });

  it("hides the whole content column from 1024 px for a phone-only screen, but not the sidebar", () => {
    const { unmount } = render(
      <AppShell title="Más" phoneOnly>
        x
      </AppShell>,
    );
    const column = screen.getByRole("main").parentElement as HTMLElement;
    expect(column.className).toContain("lg:hidden");
    expect(column.contains(screen.getByRole("heading", { level: 1 }))).toBe(true);
    expect(column.contains(document.querySelector("[data-slot='sidebar']"))).toBe(false);
    unmount();

    render(<AppShell title="Inicio">x</AppShell>);
    expect((screen.getByRole("main").parentElement as HTMLElement).className).not.toContain(
      "lg:hidden",
    );
  });

  it("has one h1, the title, and the actions before the avatar", () => {
    render(
      <AppShell title="Cuentas" user={USER} actions={<button type="button">Acción</button>}>
        x
      </AppShell>,
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const buttons = screen
      .getAllByRole("button")
      .map((button) => button.textContent || button.getAttribute("aria-label"));
    expect(buttons).toEqual(["Acción", "Menú de la cuenta"]);
  });

  describe("the title as a place for the focus", () => {
    it("can be focused by script but is not in the tab order", () => {
      render(<AppShell title="Hola, Ana">x</AppShell>);
      const title = screen.getByRole("heading", { level: 1 });
      expect(title.getAttribute("tabindex")).toBe("-1");
      // The panel that created an account sends the focus here (account-panel-sheet.test.tsx).
      title.focus();
      expect(document.activeElement).toBe(title);
    });
  });

  describe("the line under the title", () => {
    it("shows the subtitle from 1024 px only, under the h1 and in the secondary color", () => {
      render(
        <AppShell title="Hola, Ana" subtitle="Miércoles 21 de octubre">
          x
        </AppShell>,
      );
      const subtitle = screen.getByText("Miércoles 21 de octubre");
      expect(subtitle.className).toContain("hidden");
      expect(subtitle.className).toContain("lg:block");
      expect(subtitle.className).toContain("text-muted-foreground");
      expect(subtitle.previousElementSibling).toBe(screen.getByRole("heading", { level: 1 }));
      expect(subtitle.closest("header")).not.toBeNull();
    });

    it("draws nothing when there is no subtitle", () => {
      render(<AppShell title="Inicio">x</AppShell>);
      expect(document.querySelector("header p")).toBeNull();
    });

    it("does not make the subtitle a heading: the screen keeps one h1", () => {
      render(
        <AppShell title="Inicio" subtitle="Miércoles 21 de octubre">
          x
        </AppShell>,
      );
      expect(screen.getAllByRole("heading")).toHaveLength(1);
      expect(screen.queryByRole("heading", { name: "Miércoles 21 de octubre" })).toBeNull();
    });
  });

  describe("what goes before the title", () => {
    it("puts the leading element (a 'Volver') before the h1, in the header", () => {
      render(
        <AppShell title="Nueva cuenta" leading={<a href="#volver">Volver</a>}>
          x
        </AppShell>,
      );
      const header = screen.getByRole("banner");
      const back = within(header).getByRole("link", { name: "Volver" });
      const title = within(header).getByRole("heading", { level: 1 });
      expect(back.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  describe("the side panel of the main action", () => {
    it("is mounted once, with the id and the currency of the space and nothing else of it", () => {
      render(
        <AppShell title="Inicio" space={SPACE}>
          x
        </AppShell>,
      );
      expect(screen.getAllByTestId("panel-host")).toHaveLength(1);
      expect(mocks.panelHost).toHaveBeenCalledWith({
        space: { id: "space-1", currency: { code: "UYU", exponent: 2 } },
      });
    });

    it("is mounted without a space too (a screen that could not load it), and opens nothing", () => {
      render(<AppShell title="Inicio">x</AppShell>);
      expect(mocks.panelHost).toHaveBeenCalledWith({ space: undefined });
    });
  });

  describe("'Registrar movimiento' (KAN-76)", () => {
    it("mounts its host once, with the id, the currency and the time zone of the space", () => {
      render(
        <AppShell title="Inicio" space={SPACE}>
          x
        </AppShell>,
      );
      expect(screen.getAllByTestId("movement-host")).toHaveLength(1);
      expect(mocks.movementHost).toHaveBeenCalledWith({
        space: {
          id: "space-1",
          currency: { code: "UYU", exponent: 2 },
          timezone: "America/Montevideo",
        },
        noAccounts: undefined,
      });
    });

    it("mounts it without a space too, and it opens nothing", () => {
      render(<AppShell title="Inicio">x</AppShell>);
      expect(mocks.movementHost).toHaveBeenCalledWith({ space: undefined, noAccounts: undefined });
    });

    it("keeps the main action of the navigation (Registrar) when the page does not say otherwise", () => {
      render(
        <AppShell title="Inicio" space={SPACE}>
          x
        </AppShell>,
      );
      expect(mocks.sidebar.mock.calls[0]?.[0]).toMatchObject({ action: undefined });
      expect(mocks.bottomNav.mock.calls[0]?.[0]).toMatchObject({ action: undefined });
    });

    it("turns the sidebar button, the + and the host to 'Nueva cuenta' when the page knows there are no accounts", () => {
      render(
        <AppShell title="Inicio" space={SPACE} noAccounts>
          x
        </AppShell>,
      );
      expect(mocks.sidebar.mock.calls[0]?.[0]).toMatchObject({ action: NEW_ACCOUNT_ACTION });
      expect(mocks.bottomNav.mock.calls[0]?.[0]).toMatchObject({ action: NEW_ACCOUNT_ACTION });
      expect(mocks.movementHost.mock.calls[0]?.[0]).toMatchObject({ noAccounts: true });
    });

    it("does not draw the + when the screen leaves out the bottom bar, but the host stays", () => {
      render(
        <AppShell title="Nueva cuenta" space={SPACE} hideBottomNav>
          x
        </AppShell>,
      );
      expect(screen.queryByRole("navigation", { name: "Principal" })).toBeNull();
      expect(screen.getAllByTestId("movement-host")).toHaveLength(1);
    });
  });
});

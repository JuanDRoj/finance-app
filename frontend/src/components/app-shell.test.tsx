import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

// The shell's client pieces have their own tests (they need the router or a QueryClientProvider).
// Here: what the shell decides, which is where each piece goes and what it leaves out.
const mocks = vi.hoisted(() => ({ userMenu: vi.fn(), sidebar: vi.fn() }));

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
  BottomNav: () => <nav data-slot="bottom-nav" aria-label="Principal" />,
}));
vi.mock("./bfcache-guard", () => ({ BfcacheGuard: () => null }));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

beforeEach(() => {
  mocks.userMenu.mockReset();
  mocks.sidebar.mockReset();
});

const USER = { display_name: "Ana Pérez", email: "ana@example.com" };
const SPACE = { name: "Mi espacio", currency: { code: "UYU", exponent: 2 } };

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
});

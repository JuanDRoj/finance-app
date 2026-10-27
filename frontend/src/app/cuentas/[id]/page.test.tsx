import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccountPage from "./page";

// The edges are mocked: the typed server client and the router. The client islands (the form's page
// and the redirect) are stand-ins that record what the page hands them.
const mocks = vi.hoisted(() => ({
  getServerApi: vi.fn(),
  get: vi.fn(),
  redirect: vi.fn(),
  editPage: vi.fn(),
  desktopRedirect: vi.fn(),
}));

vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/components/user-menu", () => ({ UserMenu: () => null }));
vi.mock("@/components/sidebar-nav", () => ({ SidebarNav: () => null }));
vi.mock("@/components/accounts/account-panel", () => ({ AccountPanelHost: () => null }));
// The sheet of "Registrar movimiento" reads the URL and the router too (KAN-76).
vi.mock("@/components/movements/movement-panel", () => ({ MovementPanelHost: () => null }));
vi.mock("@/components/bottom-nav", () => ({ BottomNav: () => null }));
vi.mock("@/components/bfcache-guard", () => ({ BfcacheGuard: () => null }));
vi.mock("@/components/back-link", () => ({ BackLink: () => <span>Volver</span> }));
vi.mock("@/components/brand/brand-font", () => ({
  brandFont: { variable: "brand-font-variable" },
}));
vi.mock("@/components/desktop-redirect", () => ({
  DesktopRedirect: (props: { to: string }) => {
    mocks.desktopRedirect(props);
    return null;
  },
}));
vi.mock("./_components/edit-account-page", () => ({
  EditAccountPage: (props: unknown) => {
    mocks.editPage(props);
    return <div data-testid="edit-page" />;
  },
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const USER = { id: "u1", email: "ana@example.com", display_name: "Ana" };
const SPACE = {
  id: "s1",
  name: "Mi espacio",
  type: "personal",
  currency: { code: "UYU", exponent: 2 },
  timezone: "America/Montevideo",
  currency_locked: false,
};
const ACCOUNT = {
  id: "a1",
  name: "Itaú",
  type: "bank",
  closing_day: null,
  due_day: null,
  archived_at: null,
  balance_minor: 8425000,
};

const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) });
const failure = (status: number, body?: { code: string; detail: string }) => ({
  error: body,
  response: new Response(null, { status }),
});

function backend(answers: { me?: unknown; spaces?: unknown; account?: unknown }) {
  mocks.get.mockImplementation(async (path: string) => {
    if (path === "/me") return answers.me ?? ok(USER);
    if (path === "/spaces") return answers.spaces ?? ok([SPACE]);
    if (path === "/spaces/{space_id}/accounts/{account_id}") return answers.account ?? ok(ACCOUNT);
    throw new Error(`unexpected path ${path}`);
  });
}

async function renderPage(id = "a1") {
  return render(await AccountPage({ params: Promise.resolve({ id }) }));
}

beforeEach(() => {
  mocks.getServerApi.mockReset().mockResolvedValue({ GET: mocks.get });
  mocks.get.mockReset();
  mocks.editPage.mockReset();
  mocks.desktopRedirect.mockReset();
  mocks.redirect.mockReset().mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  });
  backend({});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("AccountPage", () => {
  it("titles the page 'Editar cuenta' and hands the form the account and the space", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Editar cuenta");
    expect(mocks.editPage).toHaveBeenCalledWith({
      account: ACCOUNT,
      space: { id: "s1", currency: { code: "UYU", exponent: 2 } },
    });
    expect(mocks.get).toHaveBeenCalledWith("/spaces/{space_id}/accounts/{account_id}", {
      params: { path: { space_id: "s1", account_id: "a1" } },
    });
  });

  it("sends a desktop to the list with that account chosen", async () => {
    await renderPage();
    expect(mocks.desktopRedirect).toHaveBeenCalledWith({ to: "/cuentas?sel=a1" });
  });

  it.each([
    ["/me", { me: failure(401, { code: "invalid_session", detail: "x" }) }],
    ["the account", { account: failure(401, { code: "invalid_session", detail: "x" }) }],
  ])("goes to /login on a 401 from %s", async (_name, answers) => {
    backend(answers);
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it("shows 'No encontramos esa cuenta' with a way back for an unknown account or a bad id", async () => {
    for (const status of [404, 422]) {
      backend({ account: failure(status, { code: "account_not_found", detail: "x" }) });
      const { unmount } = await renderPage("zzz");
      expect(screen.getByText("No encontramos esa cuenta")).toBeTruthy();
      expect(screen.getByText("Ir a Cuentas").closest("a")?.getAttribute("href")).toBe("/cuentas");
      expect(screen.queryByTestId("edit-page")).toBeNull();
      unmount();
    }
  });

  it("treats an archived account as not there", async () => {
    backend({ account: ok({ ...ACCOUNT, archived_at: "2026-09-01T00:00:00Z" }) });
    await renderPage();
    expect(screen.getByText("No encontramos esa cuenta")).toBeTruthy();
    expect(screen.queryByTestId("edit-page")).toBeNull();
  });

  it("explains another failure with its own text", async () => {
    backend({ account: failure(500, { code: "internal_error", detail: "boom" }) });
    await renderPage();
    expect(screen.getByText("Algo salió mal de nuestro lado")).toBeTruthy();
  });

  it("shows an Alert with Reintentar when /me or /spaces fail, and a notice without a space", async () => {
    backend({ me: failure(500, { code: "internal_error", detail: "boom" }) });
    const { unmount } = await renderPage();
    expect(screen.getByText("Reintentar").closest("a")?.getAttribute("href")).toBe("/cuentas/a1");
    unmount();
    backend({ spaces: ok([]) });
    await renderPage();
    expect(screen.getByText("Todavía no tienes un espacio")).toBeTruthy();
  });
});

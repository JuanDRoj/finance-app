import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccountsPage from "./page";

// The edges are mocked: the typed server client and the router. The screen (a client island with its
// own test) is a stand-in that records what the page hands it. What is under test is the page's
// own logic: the 401 rule, the failures, the neto of the subtitle and the action of the header.
const mocks = vi.hoisted(() => ({
  getServerApi: vi.fn(),
  get: vi.fn(),
  redirect: vi.fn(),
  screen: vi.fn(),
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
vi.mock("@/components/brand/brand-font", () => ({
  brandFont: { variable: "brand-font-variable" },
}));
vi.mock("./_components/accounts-screen", () => ({
  AccountsScreen: (props: unknown) => {
    mocks.screen(props);
    return <div data-testid="accounts-screen" />;
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
const BANK = {
  id: "a1",
  name: "Itaú",
  type: "bank",
  closing_day: null,
  due_day: null,
  archived_at: null,
  balance_minor: 8425000,
};
const CARD = { ...BANK, id: "a3", type: "credit_card", balance_minor: -2412000 };
const ARCHIVED = { ...BANK, id: "a4", balance_minor: 999, archived_at: "2026-09-01T10:00:00Z" };

function ok(data: unknown) {
  return { data, response: new Response(null, { status: 200 }) };
}
function failure(status: number, body?: { code: string; detail: string }) {
  return { error: body, response: new Response(null, { status }) };
}

function backend(answers: { me?: unknown; spaces?: unknown; accounts?: unknown }) {
  mocks.get.mockImplementation(async (path: string) => {
    if (path === "/me") return answers.me ?? ok(USER);
    if (path === "/spaces") return answers.spaces ?? ok([SPACE]);
    if (path === "/spaces/{space_id}/accounts") return answers.accounts ?? ok([BANK, CARD]);
    throw new Error(`unexpected path ${path}`);
  });
}

async function renderPage() {
  const ui = await AccountsPage();
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  mocks.getServerApi.mockReset().mockResolvedValue({ GET: mocks.get });
  mocks.get.mockReset();
  mocks.screen.mockReset();
  mocks.redirect.mockReset().mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  });
  backend({});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("AccountsPage", () => {
  it("titles the screen Cuentas, with the neto of the active accounts under it", async () => {
    backend({ accounts: ok([BANK, CARD, ARCHIVED]) });
    await renderPage();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Cuentas");
    // 84.250,00 available − 24.120,00 owed; the archived account does not count.
    expect(screen.getByText("Neto $ 60.130,00 · disponible menos deuda")).toBeTruthy();
  });

  it("asks for the archived accounts too and hands the screen the space", async () => {
    await renderPage();
    expect(mocks.get).toHaveBeenCalledWith("/spaces/{space_id}/accounts", {
      params: { path: { space_id: "s1" }, query: { include_archived: true } },
    });
    expect(mocks.screen).toHaveBeenCalledWith({
      space: { id: "s1", currency: { code: "UYU", exponent: 2 } },
    });
  });

  it("has 'Nueva cuenta' in the header, a link to the form's page that opens the panel from 1024 px", async () => {
    await renderPage();
    const action = within(screen.getByRole("banner")).getByRole("link", { name: "Nueva cuenta" });
    expect(action.getAttribute("href")).toBe("/cuentas/nueva");
  });

  describe("the main action of the shell (KAN-76)", () => {
    const sidebar = () => within(document.querySelector("[data-slot='sidebar']") as HTMLElement);

    it("is 'Registrar', which opens the sheet over the screen, when there are active accounts", async () => {
      await renderPage();
      const link = sidebar().getByRole("link", { name: "Registrar" });
      expect(link.getAttribute("href")).toBe("/?movimiento=nuevo");
      expect(sidebar().queryByRole("link", { name: "Nueva cuenta" })).toBeNull();
    });

    it("is 'Nueva cuenta' when there are no accounts at all", async () => {
      backend({ accounts: ok([]) });
      await renderPage();
      expect(sidebar().getByRole("link", { name: "Nueva cuenta" }).getAttribute("href")).toBe(
        "/cuentas/nueva",
      );
      expect(sidebar().queryByRole("link", { name: "Registrar" })).toBeNull();
    });

    it("is 'Nueva cuenta' when every account is archived: nothing can be registered on those", async () => {
      backend({ accounts: ok([ARCHIVED]) });
      await renderPage();
      expect(sidebar().getByRole("link", { name: "Nueva cuenta" })).toBeTruthy();
    });

    it("stays 'Registrar' when the accounts failed to load: the page never takes that for 'no accounts'", async () => {
      backend({ accounts: failure(500, { code: "internal_error", detail: "boom" }) });
      await renderPage();
      expect(sidebar().getByRole("link", { name: "Registrar" })).toBeTruthy();
    });
  });

  it.each([
    ["/me", { me: failure(401, { code: "invalid_session", detail: "x" }) }],
    ["/spaces", { spaces: failure(401, { code: "invalid_session", detail: "x" }) }],
    ["the accounts", { accounts: failure(401, { code: "invalid_session", detail: "x" }) }],
  ])("goes to /login on a 401 from %s", async (_name, answers) => {
    backend(answers);
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it("shows an Alert with Reintentar when /me or /spaces fail", async () => {
    backend({ me: failure(500, { code: "internal_error", detail: "boom" }) });
    await renderPage();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Reintentar").closest("a")?.getAttribute("href")).toBe("/cuentas");
    expect(screen.queryByTestId("accounts-screen")).toBeNull();
  });

  it("leaves a failing accounts call to the screen (its own error state) and has no neto", async () => {
    backend({ accounts: failure(500, { code: "internal_error", detail: "boom" }) });
    await renderPage();
    expect(screen.getByTestId("accounts-screen")).toBeTruthy();
    expect(screen.queryByText(/Neto/)).toBeNull();
  });

  it("shows a notice when there is no space", async () => {
    backend({ spaces: ok([]) });
    await renderPage();
    expect(screen.getByText("Todavía no tienes un espacio")).toBeTruthy();
    expect(screen.queryByTestId("accounts-screen")).toBeNull();
  });
});

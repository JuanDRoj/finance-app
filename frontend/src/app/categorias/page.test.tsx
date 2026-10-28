import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CategoriesPage from "./page";

// The edges are mocked: the typed server client and the router. The screen (a client island with its
// own test) is a stand-in that records what the page hands it. What is under test is the page's own
// logic: the 401 rule, the failures, the header with its "Volver" and its action, and the prefetch.
const mocks = vi.hoisted(() => ({
  getServerApi: vi.fn(),
  get: vi.fn(),
  redirect: vi.fn(),
  screen: vi.fn(),
  back: vi.fn(),
  search: "",
}));

vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("@/components/user-menu", () => ({ UserMenu: () => null }));
vi.mock("@/components/sidebar-nav", () => ({ SidebarNav: () => null }));
vi.mock("@/components/accounts/account-panel", () => ({ AccountPanelHost: () => null }));
vi.mock("@/components/movements/movement-panel", () => ({ MovementPanelHost: () => null }));
vi.mock("@/components/bottom-nav", () => ({ BottomNav: () => null }));
vi.mock("@/components/bfcache-guard", () => ({ BfcacheGuard: () => null }));
vi.mock("@/components/back-link", () => ({
  BackLink: (props: { fallbackHref?: string; className?: string }) => {
    mocks.back(props);
    return <span>Volver</span>;
  },
}));
vi.mock("@/components/brand/brand-font", () => ({
  brandFont: { variable: "brand-font-variable" },
}));
vi.mock("./_components/categories-screen", () => ({
  CategoriesScreen: (props: unknown) => {
    mocks.screen(props);
    return <div data-testid="categories-screen" />;
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
const CATEGORY = {
  id: "c1",
  name: "Comida",
  kind: "expense",
  icon: "fork-knife",
  parent_id: null,
  archived_at: null,
};

const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) });
const failure = (status: number, body?: { code: string; detail: string }) => ({
  error: body,
  response: new Response(null, { status }),
});

function backend(answers: { me?: unknown; spaces?: unknown; categories?: unknown }) {
  mocks.get.mockImplementation(async (path: string) => {
    if (path === "/me") return answers.me ?? ok(USER);
    if (path === "/spaces") return answers.spaces ?? ok([SPACE]);
    if (path === "/spaces/{space_id}/categories") return answers.categories ?? ok([CATEGORY]);
    throw new Error(`unexpected path ${path}`);
  });
}

async function renderPage() {
  const ui = await CategoriesPage();
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  mocks.getServerApi.mockReset().mockResolvedValue({ GET: mocks.get });
  mocks.get.mockReset();
  mocks.screen.mockReset();
  mocks.back.mockReset();
  mocks.search = "";
  mocks.redirect.mockReset().mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  });
  backend({});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("CategoriesPage", () => {
  it("titles the screen Categorías, with the line of the canvas under it", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Categorías");
    expect(screen.getByText("Agrupa tus gastos e ingresos en dos niveles")).toBeTruthy();
  });

  it("asks for the archived categories too and hands the screen the space and its time zone", async () => {
    await renderPage();
    expect(mocks.get).toHaveBeenCalledWith("/spaces/{space_id}/categories", {
      params: { path: { space_id: "s1" }, query: { include_archived: true } },
    });
    expect(mocks.screen).toHaveBeenCalledWith({
      space: { id: "s1", timezone: "America/Montevideo" },
    });
  });

  it("has 'Volver' to Más, shown only below 1024 px", async () => {
    await renderPage();
    expect(mocks.back).toHaveBeenCalledWith({ fallbackHref: "/mas", className: "lg:hidden" });
  });

  it("has 'Nueva categoría' in the header: a link to the form's page that opens the panel from 1024 px", async () => {
    await renderPage();
    const action = within(screen.getByRole("banner")).getByRole("link", {
      name: "Nueva categoría",
    });
    expect(action.getAttribute("href")).toBe("/categorias/nueva?tipo=gastos");
  });

  it("starts 'Nueva categoría' on the tab the list is showing", async () => {
    mocks.search = "tipo=ingresos";
    await renderPage();
    const action = within(screen.getByRole("banner")).getByRole("link", {
      name: "Nueva categoría",
    });
    expect(action.getAttribute("href")).toBe("/categorias/nueva?tipo=ingresos");
  });

  it("keeps the shell's main action as 'Registrar': the page does not know about accounts", async () => {
    await renderPage();
    const sidebar = within(document.querySelector("[data-slot='sidebar']") as HTMLElement);
    expect(sidebar.getByRole("link", { name: "Registrar" }).getAttribute("href")).toBe(
      "/?movimiento=nuevo",
    );
  });

  it.each([
    ["/me", { me: failure(401, { code: "invalid_session", detail: "x" }) }],
    ["/spaces", { spaces: failure(401, { code: "invalid_session", detail: "x" }) }],
    ["the categories", { categories: failure(401, { code: "invalid_session", detail: "x" }) }],
  ])("goes to /login on a 401 from %s", async (_name, answers) => {
    backend(answers);
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it("shows an Alert with Reintentar, and a way back, when /me or /spaces fail", async () => {
    backend({ me: failure(500, { code: "internal_error", detail: "boom" }) });
    await renderPage();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Reintentar").closest("a")?.getAttribute("href")).toBe("/categorias");
    expect(screen.queryByTestId("categories-screen")).toBeNull();
    expect(mocks.back).toHaveBeenCalled();
  });

  it("leaves a failing list of categories to the screen (its own error state)", async () => {
    backend({ categories: failure(500, { code: "internal_error", detail: "boom" }) });
    await renderPage();
    expect(screen.getByTestId("categories-screen")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a notice when there is no space", async () => {
    backend({ spaces: ok([]) });
    await renderPage();
    expect(screen.getByText("Todavía no tienes un espacio")).toBeTruthy();
    expect(screen.queryByTestId("categories-screen")).toBeNull();
  });

  it("logs only the kind of failure, never its message", async () => {
    backend({ me: failure(500, { code: "internal_error", detail: "secret detail" }) });
    await renderPage();
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain("500");
    expect(logged).not.toContain("secret detail");
  });
});

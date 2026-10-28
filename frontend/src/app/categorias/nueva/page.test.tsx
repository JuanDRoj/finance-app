import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NewCategoryPage from "./page";

// The edges are mocked: the typed server client and the router. The client islands (the form's page
// and the redirect) are stand-ins that record what the page hands them.
const mocks = vi.hoisted(() => ({
  getServerApi: vi.fn(),
  get: vi.fn(),
  redirect: vi.fn(),
  form: vi.fn(),
  desktopRedirect: vi.fn(),
}));

vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/components/user-menu", () => ({ UserMenu: () => null }));
vi.mock("@/components/sidebar-nav", () => ({ SidebarNav: () => null }));
vi.mock("@/components/accounts/account-panel", () => ({ AccountPanelHost: () => null }));
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
vi.mock("./_components/new-category-page-form", () => ({
  NewCategoryPageForm: (props: unknown) => {
    mocks.form(props);
    return <div data-testid="form" />;
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

async function renderPage(query: { tipo?: string | string[]; padre?: string | string[] } = {}) {
  return render(await NewCategoryPage({ searchParams: Promise.resolve(query) }));
}

beforeEach(() => {
  mocks.getServerApi.mockReset().mockResolvedValue({ GET: mocks.get });
  mocks.get.mockReset();
  mocks.form.mockReset();
  mocks.desktopRedirect.mockReset();
  mocks.redirect.mockReset().mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  });
  backend({});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("NewCategoryPage", () => {
  it("is 'Nueva categoría' with the form, the whole list (archived ones too) and nothing chosen", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Nueva categoría");
    expect(mocks.get).toHaveBeenCalledWith("/spaces/{space_id}/categories", {
      params: { path: { space_id: "s1" }, query: { include_archived: true } },
    });
    expect(mocks.form).toHaveBeenCalledWith({
      space: { id: "s1" },
      categories: [CATEGORY],
      defaults: { kind: undefined, parentId: undefined },
    });
  });

  it("starts the form on the kind and the principal of the address", async () => {
    await renderPage({ tipo: "ingresos", padre: "p1" });
    expect(mocks.form.mock.calls[0]?.[0].defaults).toEqual({ kind: "income", parentId: "p1" });
  });

  it("ignores a kind it does not know, and takes the first of a repeated param", async () => {
    await renderPage({ tipo: ["otro", "ingresos"], padre: ["p1", "p2"] });
    expect(mocks.form.mock.calls[0]?.[0].defaults).toEqual({ kind: undefined, parentId: "p1" });
  });

  it("sends a desktop to the list with the panel open and the same kind and principal", async () => {
    await renderPage({ tipo: "ingresos", padre: "p1" });
    expect(mocks.desktopRedirect).toHaveBeenCalledWith({
      to: "/categorias?categoria=nueva&tipo=ingresos&padre=p1",
    });
  });

  it("sends a desktop to the panel with nothing chosen when the address has no params", async () => {
    await renderPage();
    expect(mocks.desktopRedirect).toHaveBeenCalledWith({ to: "/categorias?categoria=nueva" });
  });

  it.each([
    ["/me", { me: failure(401, { code: "invalid_session", detail: "x" }) }],
    ["/spaces", { spaces: failure(401, { code: "invalid_session", detail: "x" }) }],
    ["the categories", { categories: failure(401, { code: "invalid_session", detail: "x" }) }],
  ])("goes to /login on a 401 from %s", async (_name, answers) => {
    backend(answers);
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it("shows an Alert with Reintentar to the same address when something fails", async () => {
    backend({ categories: failure(500, { code: "internal_error", detail: "boom" }) });
    await renderPage({ tipo: "ingresos" });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Reintentar").closest("a")?.getAttribute("href")).toBe(
      "/categorias/nueva?tipo=ingresos",
    );
    expect(screen.queryByTestId("form")).toBeNull();
    // The visitor on desktop still goes to the panel, which asks for its own list.
    expect(mocks.desktopRedirect).toHaveBeenCalled();
  });

  it("shows an Alert when /me or /spaces fail", async () => {
    backend({ me: failure(500, { code: "internal_error", detail: "boom" }) });
    await renderPage();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByTestId("form")).toBeNull();
  });

  it("shows a notice, not a form with nowhere to create, when there is no space", async () => {
    backend({ spaces: ok([]) });
    await renderPage();
    expect(screen.getByText("Todavía no tienes un espacio")).toBeTruthy();
    expect(screen.queryByTestId("form")).toBeNull();
  });
});

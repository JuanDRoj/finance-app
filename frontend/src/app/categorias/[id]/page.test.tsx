import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CategoryPage from "./page";

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
vi.mock("./_components/edit-category-page", () => ({
  EditCategoryPage: (props: unknown) => {
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
const COMIDA = {
  id: "c1",
  name: "Comida",
  kind: "expense",
  icon: "fork-knife",
  parent_id: null,
  archived_at: null,
};
const MASCOTAS = { ...COMIDA, id: "c9", name: "Mascotas", archived_at: "2026-10-18T15:00:00Z" };

const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) });
const failure = (status: number, body?: { code: string; detail: string }) => ({
  error: body,
  response: new Response(null, { status }),
});

function backend(answers: { me?: unknown; spaces?: unknown; categories?: unknown }) {
  mocks.get.mockImplementation(async (path: string) => {
    if (path === "/me") return answers.me ?? ok(USER);
    if (path === "/spaces") return answers.spaces ?? ok([SPACE]);
    if (path === "/spaces/{space_id}/categories") {
      return answers.categories ?? ok([COMIDA, MASCOTAS]);
    }
    throw new Error(`unexpected path ${path}`);
  });
}

async function renderPage(id = "c1") {
  return render(await CategoryPage({ params: Promise.resolve({ id }) }));
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

describe("CategoryPage", () => {
  it("is 'Editar categoría' with the form of that category and the whole list", async () => {
    await renderPage("c1");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Editar categoría");
    expect(mocks.get).toHaveBeenCalledWith("/spaces/{space_id}/categories", {
      params: { path: { space_id: "s1" }, query: { include_archived: true } },
    });
    expect(mocks.editPage).toHaveBeenCalledWith({
      category: COMIDA,
      categories: [COMIDA, MASCOTAS],
      space: { id: "s1" },
    });
    expect(screen.getByTestId("edit-page")).toBeTruthy();
  });

  it("sends a desktop to the list with the edit panel of that category open", async () => {
    await renderPage("c1");
    expect(mocks.desktopRedirect).toHaveBeenCalledWith({
      to: "/categorias?categoria=editar&id=c1",
    });
  });

  it.each([
    ["is not in the list", "nope"],
    ["is archived", "c9"],
  ])("says 'No encontramos esa categoría', with a way back, when it %s", async (_why, id) => {
    await renderPage(id);
    expect(screen.getByText("No encontramos esa categoría")).toBeTruthy();
    expect(screen.getByText("Ir a Categorías").closest("a")?.getAttribute("href")).toBe(
      "/categorias",
    );
    expect(screen.queryByTestId("edit-page")).toBeNull();
    expect(screen.queryByText("category_not_found")).toBeNull();
  });

  it.each([
    ["/me", { me: failure(401, { code: "invalid_session", detail: "x" }) }],
    ["/spaces", { spaces: failure(401, { code: "invalid_session", detail: "x" }) }],
    ["the categories", { categories: failure(401, { code: "invalid_session", detail: "x" }) }],
  ])("goes to /login on a 401 from %s", async (_name, answers) => {
    backend(answers);
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it("shows an Alert with Reintentar to the same page when something fails", async () => {
    backend({ categories: failure(500, { code: "internal_error", detail: "boom" }) });
    await renderPage("c1");
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Reintentar").closest("a")?.getAttribute("href")).toBe(
      "/categorias/c1",
    );
    expect(screen.queryByTestId("edit-page")).toBeNull();
  });

  it("shows an Alert when /me or /spaces fail", async () => {
    backend({ me: failure(500, { code: "internal_error", detail: "boom" }) });
    await renderPage();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByTestId("edit-page")).toBeNull();
  });

  it("shows a notice when there is no space", async () => {
    backend({ spaces: ok([]) });
    await renderPage();
    expect(screen.getByText("Todavía no tienes un espacio")).toBeTruthy();
    expect(screen.queryByTestId("edit-page")).toBeNull();
  });
});

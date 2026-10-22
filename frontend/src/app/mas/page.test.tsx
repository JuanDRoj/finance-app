import { cleanup, render, screen } from "@testing-library/react";
import { Tag } from "@phosphor-icons/react/ssr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MoreSection } from "@/components/nav-sections";
import type { UserRead } from "@/lib/core/data/me";
import type { SpaceRead } from "@/lib/core/data/spaces";
import MorePage from "./page";

// The edges are mocked, as in app/page.test.tsx: the typed API client, the router and the client
// pieces of the shell. What is under test is the page's own logic: what it lists, the redirects
// and the error state. `MORE_SECTIONS` is empty in the app until Categorías exists, so the tests
// fill it.
const mocks = vi.hoisted(() => ({
  getServerApi: vi.fn(),
  get: vi.fn(),
  redirect: vi.fn(),
  more: [] as unknown[],
}));

vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/components/nav-sections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/nav-sections")>()),
  MORE_SECTIONS: mocks.more,
}));
vi.mock("@/components/user-menu", () => ({
  UserMenu: () => <button type="button" aria-label="Menú de la cuenta" />,
}));
vi.mock("@/components/sidebar-nav", () => ({ SidebarNav: () => null }));
vi.mock("@/components/bottom-nav", () => ({ BottomNav: () => null }));
vi.mock("@/components/bfcache-guard", () => ({ BfcacheGuard: () => null }));
// `next/font` only works inside Next's compiler: the sidebar's logo writes the name with it.
vi.mock("@/components/brand/brand-font", () => ({
  brandFont: { variable: "brand-font-variable" },
}));
vi.mock("@/components/desktop-redirect", () => ({
  DesktopRedirect: () => <span data-testid="desktop-redirect" />,
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const USER: UserRead = { id: "u1", email: "ana.perez@example.com", display_name: "Ana Pérez" };
const SPACE: SpaceRead = {
  id: "s1",
  name: "Mi espacio",
  type: "personal",
  currency: { code: "UYU", exponent: 2 },
  timezone: "America/Montevideo",
  currency_locked: false,
};
const CATEGORIES: MoreSection = {
  id: "categories",
  href: "/categorias",
  label: "Categorías",
  icon: Tag,
  description: "Crea, renombra y archiva las tuyas",
};

function ok(data: unknown) {
  return { data, response: new Response(null, { status: 200 }) };
}

function failure(status: number, body?: { code: string; detail: string }) {
  return { error: body, response: new Response(null, { status }) };
}

function backend(answers: { me?: unknown; spaces?: unknown }) {
  mocks.get.mockImplementation(async (path: string) => {
    if (path === "/me") return answers.me ?? ok(USER);
    if (path === "/spaces") return answers.spaces ?? ok([SPACE]);
    throw new Error(`unexpected path ${path}`);
  });
}

beforeEach(() => {
  mocks.more.length = 0;
  mocks.more.push(CATEGORIES);
  mocks.getServerApi.mockReset().mockResolvedValue({ GET: mocks.get });
  mocks.get.mockReset();
  // `redirect()` works by throwing; the stand-in does too, so the page stops like the real one.
  mocks.redirect.mockReset().mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  });
  backend({});
});

async function renderMore() {
  return render(await MorePage());
}

describe("MorePage", () => {
  it("is 'Más', with the group 'Organiza' and a row for each section that hangs from it", async () => {
    await renderMore();
    expect(screen.getByRole("heading", { level: 1, name: "Más" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Organiza" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Categorías/ }).getAttribute("href")).toBe(
      "/categorias",
    );
  });

  it("sends desktop visitors to the home, and hides the list from 1024 px meanwhile", async () => {
    await renderMore();
    expect(screen.getByTestId("desktop-redirect")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Organiza" }).parentElement?.className).toContain(
      "lg:hidden",
    );
  });

  it("goes to the home when nothing hangs from Más, without asking the backend", async () => {
    mocks.more.length = 0;
    await expect(MorePage()).rejects.toThrow("NEXT_REDIRECT /");
    expect(mocks.redirect).toHaveBeenCalledWith("/");
    expect(mocks.getServerApi).not.toHaveBeenCalled();
  });

  it("gives the shell the space, so the sidebar names it", async () => {
    await renderMore();
    expect(screen.getByText("Mi espacio")).toBeTruthy();
    expect(screen.getByText("Peso uruguayo · UYU")).toBeTruthy();
  });

  it("goes to /login on a 401 from either call", async () => {
    backend({ me: failure(401, { code: "not_authenticated", detail: "Not authenticated" }) });
    await expect(MorePage()).rejects.toThrow("NEXT_REDIRECT /login");

    backend({ spaces: failure(401, { code: "invalid_session", detail: "Invalid session" }) });
    await expect(MorePage()).rejects.toThrow("NEXT_REDIRECT /login");
  });

  describe("when the backend fails", () => {
    let logged: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      logged = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      logged.mockRestore();
    });

    it("shows the error in Spanish with a way to try again on /mas, and not the list", async () => {
      backend({
        spaces: failure(500, { code: "internal_error", detail: "Internal Server Error" }),
      });
      await renderMore();
      expect(screen.getByRole("alert").textContent).toContain("Algo salió mal de nuestro lado");
      expect(screen.queryByText(/Internal Server Error|internal_error/)).toBeNull();
      expect(screen.queryByRole("heading", { level: 2, name: "Organiza" })).toBeNull();
      expect(screen.getByText("Reintentar").closest("a")?.getAttribute("href")).toBe("/mas");
      expect(mocks.redirect).not.toHaveBeenCalled();
    });

    it("keeps the account menu on the error screen", async () => {
      backend({ me: failure(502) });
      await renderMore();
      expect(screen.getAllByRole("button", { name: "Menú de la cuenta" }).length).toBeGreaterThan(
        0,
      );
    });

    it("logs only the kind of failure, never a message", async () => {
      backend({ me: failure(503, { code: "x", detail: "ana.perez@example.com" }) });
      await renderMore();
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged.mock.calls[0]?.[1]).toEqual({ status: 503 });
      expect(JSON.stringify(logged.mock.calls)).not.toContain("ana.perez");
    });
  });
});

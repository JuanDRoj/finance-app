import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRead } from "@/lib/core/data/me";
import type { SpaceRead } from "@/lib/core/data/spaces";
import NewAccountPage from "./page";

// The edges are mocked, as in app/mas/page.test.tsx: the typed API client, the router and the
// client pieces. What is under test is the page's own logic: the redirects, the error and empty
// states, and what it hands the form and the redirect.
const mocks = vi.hoisted(() => ({
  getServerApi: vi.fn(),
  get: vi.fn(),
  redirect: vi.fn(),
  desktopRedirect: vi.fn(),
  form: vi.fn(),
}));

vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/components/user-menu", () => ({
  UserMenu: () => <button type="button" aria-label="Menú de la cuenta" />,
}));
vi.mock("@/components/sidebar-nav", () => ({ SidebarNav: () => null }));
vi.mock("@/components/bottom-nav", () => ({
  BottomNav: () => <nav data-slot="bottom-nav" aria-label="Principal" />,
}));
vi.mock("@/components/bfcache-guard", () => ({ BfcacheGuard: () => null }));
vi.mock("@/components/accounts/account-panel", () => ({ AccountPanelHost: () => null }));
// The sheet of "Registrar movimiento" reads the URL and the router too (KAN-76).
vi.mock("@/components/movements/movement-panel", () => ({ MovementPanelHost: () => null }));
vi.mock("@/components/primary-action-link", () => ({
  PrimaryActionLink: ({ children }: { children: React.ReactNode }) => <a href="/x">{children}</a>,
}));
// `next/font` only works inside Next's compiler: the sidebar's logo writes the name with it.
vi.mock("@/components/brand/brand-font", () => ({
  brandFont: { variable: "brand-font-variable" },
}));
vi.mock("@/components/back-link", () => ({
  BackLink: () => <a href="#volver">Volver</a>,
}));
vi.mock("@/components/desktop-redirect", () => ({
  DesktopRedirect: (props: { to?: string }) => {
    mocks.desktopRedirect(props);
    return <span data-testid="desktop-redirect" />;
  },
}));
vi.mock("./_components/new-account-page-form", () => ({
  NewAccountPageForm: (props: unknown) => {
    mocks.form(props);
    return <form aria-label="Formulario de cuenta" />;
  },
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

async function renderPage() {
  return render(await NewAccountPage());
}

beforeEach(() => {
  mocks.getServerApi.mockReset().mockResolvedValue({ GET: mocks.get });
  mocks.get.mockReset();
  mocks.desktopRedirect.mockReset();
  mocks.form.mockReset();
  // `redirect()` works by throwing; the stand-in does too, so the page stops like the real one.
  mocks.redirect.mockReset().mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  });
  backend({});
});

describe("NewAccountPage", () => {
  it("is the page of the form: 'Nueva cuenta' as the h1, with 'Volver' and the form in a card", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Nueva cuenta" })).toBeTruthy();
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "Volver" })).toBeTruthy();
    const main = screen.getByRole("main");
    expect(within(main).getByRole("form", { name: "Formulario de cuenta" })).toBeTruthy();
    expect(main.querySelector("[data-slot='card']")).not.toBeNull();
  });

  it("hands the form the id and the currency of the first space, and nothing else of it", async () => {
    await renderPage();
    expect(mocks.form).toHaveBeenCalledWith({
      space: { id: "s1", currency: { code: "UYU", exponent: 2 } },
    });
  });

  it("has no bottom bar: the keyboard needs the room", async () => {
    await renderPage();
    expect(document.querySelector("[data-slot='bottom-nav']")).toBeNull();
  });

  it("exists only below 1024 px: its column is hidden from there while the desktop is sent away", async () => {
    await renderPage();
    expect((screen.getByRole("main").parentElement as HTMLElement).className).toContain(
      "lg:hidden",
    );
    expect(screen.getByTestId("desktop-redirect")).toBeTruthy();
    // To the Inicio with the panel open over it.
    expect(mocks.desktopRedirect).toHaveBeenCalledWith({ to: "/cuentas?cuenta=nueva" });
  });

  it("keeps the account menu in the header and in the sidebar, as every screen with a session", async () => {
    await renderPage();
    expect(screen.getAllByRole("button", { name: "Menú de la cuenta" })).toHaveLength(2);
  });

  it("asks /me and /spaces once each", async () => {
    await renderPage();
    expect(mocks.get.mock.calls.map(([path]) => path).sort()).toEqual(["/me", "/spaces"]);
  });

  describe("without a valid session", () => {
    it("goes to /login on a 401 from /me or from /spaces", async () => {
      backend({ me: failure(401, { code: "not_authenticated", detail: "Not authenticated" }) });
      await expect(NewAccountPage()).rejects.toThrow("NEXT_REDIRECT /login");
      backend({ spaces: failure(401) });
      await expect(NewAccountPage()).rejects.toThrow("NEXT_REDIRECT /login");
      expect(mocks.redirect).toHaveBeenCalledWith("/login");
    });
  });

  describe("when the backend fails", () => {
    let logged: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      logged = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      logged.mockRestore();
    });

    it("shows the error in Spanish with a way to try again, and no form", async () => {
      backend({
        spaces: failure(500, { code: "internal_error", detail: "Internal Server Error" }),
      });
      await renderPage();
      expect(screen.getByRole("alert").textContent).toContain("Algo salió mal de nuestro lado");
      expect(screen.queryByText(/Internal Server Error|internal_error/)).toBeNull();
      expect(screen.getByText("Reintentar").closest("a")?.getAttribute("href")).toBe(
        "/cuentas/nueva",
      );
      expect(screen.queryByRole("form")).toBeNull();
      expect(mocks.redirect).not.toHaveBeenCalled();
    });

    it("still sends a desktop visitor away, and keeps the page phone-only", async () => {
      backend({ me: failure(502) });
      await renderPage();
      expect(mocks.desktopRedirect).toHaveBeenCalledWith({ to: "/cuentas?cuenta=nueva" });
      expect((screen.getByRole("main").parentElement as HTMLElement).className).toContain(
        "lg:hidden",
      );
    });

    it("logs only the kind of failure, never the message", async () => {
      mocks.get.mockImplementation(async (path: string) => {
        if (path === "/me") throw new SyntaxError("Unexpected token < in JSON: <html>secret");
        return ok([SPACE]);
      });
      await renderPage();
      expect(logged).toHaveBeenCalledWith("Nueva cuenta: could not load /me and /spaces", {
        kind: "SyntaxError",
      });
      expect(JSON.stringify(logged.mock.calls)).not.toContain("secret");
    });

    it("logs the status of an ApiError and nothing of its body", async () => {
      backend({ me: failure(503, { code: "x", detail: "ana.perez@example.com" }) });
      await renderPage();
      expect(logged.mock.calls[0]?.[1]).toEqual({ status: 503 });
      expect(JSON.stringify(logged.mock.calls)).not.toContain("ana.perez");
    });
  });

  describe("without spaces", () => {
    it("says so instead of showing a form with nowhere to create the account", async () => {
      backend({ spaces: ok([]) });
      await renderPage();
      expect(screen.getByRole("status").textContent).toContain("Todavía no tienes un espacio");
      expect(screen.queryByRole("form")).toBeNull();
      expect(mocks.form).not.toHaveBeenCalled();
    });
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountsQueryKey } from "@/lib/core/data/accounts";
import { dashboardKey, dashboardSeriesKey } from "@/lib/core/data/dashboard";
import type { SpaceRead } from "@/lib/core/data/spaces";
import type { UserRead } from "@/lib/core/data/me";
import { recentTransactionsKey } from "@/lib/core/data/transactions";
import HomePage from "./page";

// The edges of the screen are mocked: the typed API client (with the session cookie) and the
// router. What is under test is the page's own logic: the greeting, the fallback of the name, the
// 401 redirect, the error and empty states and, with accounts, what it prefetches for the dashboard
// (and that the client finds it under the same keys), the month and the day of the space, and what it
// hands the screen. The dashboard itself is a stand-in (`DashboardScreen` has its own tests).
const mocks = vi.hoisted(() => ({
  getServerApi: vi.fn(),
  get: vi.fn(),
  redirect: vi.fn(),
  userMenu: vi.fn(),
  currencyCard: vi.fn(),
  screen: vi.fn(),
}));

vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));
// The shell's client pieces need a QueryClientProvider, the router and the browser; they have
// their own tests. Here only what the shell hands them matters: the user menu is where
// "Cerrar sesión" lives (KAN-41), so the stand-in records the props it receives.
vi.mock("@/components/user-menu", () => ({
  UserMenu: (props: { user?: unknown; variant?: string }) => {
    mocks.userMenu(props);
    return <button type="button" aria-label="Menú de la cuenta" />;
  },
}));
vi.mock("@/components/sidebar-nav", () => ({ SidebarNav: () => null }));
// The side panel and the card of the currency are client islands with their own tests (they need a
// QueryClientProvider and the router): the stand-in of the card records what the page hands it.
vi.mock("@/components/accounts/account-panel", () => ({ AccountPanelHost: () => null }));
// The sheet of "Registrar movimiento" reads the URL and the router too (KAN-76).
vi.mock("@/components/movements/movement-panel", () => ({ MovementPanelHost: () => null }));
vi.mock("@/components/currency/currency-card", () => ({
  CurrencyCard: (props: { space: { id: string; currency: { code: string } } }) => {
    mocks.currencyCard(props);
    return <section aria-label="Moneda de tu espacio" />;
  },
}));
// The dashboard (KAN-84) has its own tests: the stand-in records what the page hands it and draws
// the card of the currency it receives, where the real screen would.
vi.mock("./_components/dashboard/dashboard-screen", () => ({
  DashboardScreen: (props: { currencyCard?: ReactNode }) => {
    mocks.screen(props);
    return (
      <div data-testid="dashboard-screen">
        <h2>Dashboard</h2>
        {props.currencyCard}
      </div>
    );
  },
}));
vi.mock("@/components/bottom-nav", () => ({ BottomNav: () => null }));
vi.mock("@/components/bfcache-guard", () => ({ BfcacheGuard: () => null }));
// `next/font` only works inside Next's compiler: the sidebar's logo writes the name with it.
vi.mock("@/components/brand/brand-font", () => ({
  brandFont: { variable: "brand-font-variable" },
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
const BANK = {
  id: "a1",
  name: "Itaú",
  type: "bank",
  closing_day: null,
  due_day: null,
  archived_at: null,
  balance_minor: 155050,
};
const CASH = { ...BANK, id: "a2", name: "Billetera", type: "cash", balance_minor: 550000 };
const CARD = {
  ...BANK,
  id: "a3",
  name: "Visa Itaú",
  type: "credit_card",
  closing_day: 5,
  due_day: 12,
  balance_minor: -2412000,
};
const DASHBOARD = {
  month: "2026-10",
  available_minor: 12890000,
  card_debt_minor: 3247000,
  net_minor: 9643000,
  month_expense_minor: 3677000,
  top_expense_categories: [
    {
      category_id: "00000000-0000-4000-8000-000000000101",
      name: "Comida",
      icon: "fork-knife",
      amount_minor: 2123000,
      percentage: 58,
    },
  ],
};
const SERIES = {
  points: [
    { month: "2026-09", income_minor: 6800000, expense_minor: 3980000, net_minor: 9210000 },
    { month: "2026-10", income_minor: 6800000, expense_minor: 3677000, net_minor: 9643000 },
  ],
};
const MOVEMENT = {
  id: "00000000-0000-4000-8000-000000000301",
  type: "expense",
  status: "confirmed",
  date: "2026-10-20",
  description: "Tienda Inglesa",
  amount_minor: -234000,
  category: null,
  account: { id: "a1", name: "Itaú", type: "bank" },
  from_account: null,
  to_account: null,
  balance_after_minor: null,
};
const RECENT = { items: [MOVEMENT], next_cursor: null };

const DASHBOARD_PATH = "/spaces/{space_id}/dashboard";
const SERIES_PATH = "/spaces/{space_id}/dashboard/series";
const RECENT_PATH = "/spaces/{space_id}/transactions";
const ACCOUNTS_PATH = "/spaces/{space_id}/accounts";

function ok(data: unknown) {
  return { data, response: new Response(null, { status: 200 }) };
}

function failure(status: number, body?: { code: string; detail: string }) {
  return { error: body, response: new Response(null, { status }) };
}

type Answers = {
  me?: unknown;
  spaces?: unknown;
  accounts?: unknown;
  dashboard?: unknown;
  series?: unknown;
  recent?: unknown;
};

/** What the calls answer; each test overrides what it needs. No accounts unless it says so. */
function backend(answers: Answers) {
  mocks.get.mockImplementation(async (path: string) => {
    if (path === "/me") return answers.me ?? ok(USER);
    if (path === "/spaces") return answers.spaces ?? ok([SPACE]);
    if (path === ACCOUNTS_PATH) return answers.accounts ?? ok([]);
    if (path === DASHBOARD_PATH) return answers.dashboard ?? ok(DASHBOARD);
    if (path === SERIES_PATH) return answers.series ?? ok(SERIES);
    if (path === RECENT_PATH) return answers.recent ?? ok(RECENT);
    throw new Error(`unexpected path ${path}`);
  });
}

/** The page inside a QueryClientProvider (the dashboard's boundary hydrates into it); the client is returned to look at its cache. */
async function renderHome() {
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>{await HomePage()}</QueryClientProvider>,
  );
  return { ...view, client };
}

beforeEach(() => {
  mocks.getServerApi.mockReset().mockResolvedValue({ GET: mocks.get });
  mocks.get.mockReset();
  mocks.userMenu.mockReset();
  mocks.currencyCard.mockReset();
  mocks.screen.mockReset();
  // `redirect()` works by throwing; the stand-in does too, so the page stops like the real one.
  mocks.redirect.mockReset().mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  });
  backend({});
});

/** The h1: where the greeting is since the Inicio is the screen of "Hola, {nombre}" (D18). */
function title() {
  return screen.getByRole("heading", { level: 1 }).textContent;
}

describe("HomePage", () => {
  it("greets the user in the title", async () => {
    await renderHome();
    expect(title()).toBe("Hola, Ana Pérez");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("writes today's date under the title, in the space's time zone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // 01:30 UTC of Thursday the 22nd is still Wednesday the 21st in Montevideo.
      vi.setSystemTime(new Date("2026-10-22T01:30:00Z"));
      await renderHome();
      const subtitle = screen.getByText("Miércoles 21 de octubre");
      expect(subtitle.closest("header")).not.toBeNull();
      expect(subtitle.className).toContain("lg:block");
    } finally {
      vi.useRealTimers();
    }
  });

  // KAN-27 made "Cerrar sesión" a button of every screen with a session; KAN-41 moved it into the
  // avatar menu (tested in user-menu.test.tsx); KAN-69 (Escritorio v2) put a second one at the
  // bottom of the sidebar. What stays true here: every screen has the menu in the header (below
  // 1024 px) and in the sidebar (from 1024 px), once each. jsdom has no CSS, so both are in the DOM.
  function headerMenu() {
    return within(screen.getByRole("banner")).getByRole("button", { name: "Menú de la cuenta" });
  }

  function sidebarMenu() {
    const sidebar = document.querySelector("[data-slot='sidebar']") as HTMLElement;
    return within(sidebar).getByRole("button", { name: "Menú de la cuenta" });
  }

  it("has the account menu in the header and in the sidebar, on the greeting and on the error screen", async () => {
    const { unmount } = await renderHome();
    expect(screen.getAllByRole("button", { name: "Menú de la cuenta" })).toHaveLength(2);
    expect(headerMenu()).toBeTruthy();
    expect(sidebarMenu()).toBeTruthy();
    unmount();

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    backend({ me: failure(500, { code: "internal_error", detail: "Internal Server Error" }) });
    await renderHome();
    expect(screen.getAllByRole("button", { name: "Menú de la cuenta" })).toHaveLength(2);
    expect(headerMenu()).toBeTruthy();
    expect(sidebarMenu()).toBeTruthy();
    logged.mockRestore();
  });

  it("has the menu on the screen without a space too", async () => {
    backend({ spaces: ok([]) });
    await renderHome();
    expect(headerMenu()).toBeTruthy();
    expect(sidebarMenu()).toBeTruthy();
  });

  it("hands each menu the name, the email and the initials of the user, and nothing else", async () => {
    await renderHome();
    // One call for the header avatar and one for the sidebar row.
    expect(mocks.userMenu).toHaveBeenCalledTimes(2);
    const calls = mocks.userMenu.mock.calls.map(([props]) => props);
    expect(calls.map((props) => props.variant)).toContain("sidebar");
    expect(calls.map((props) => props.variant)).toContain(undefined);
    for (const props of calls) {
      expect(props.user).toEqual({
        name: "Ana Pérez",
        email: "ana.perez@example.com",
        initials: "AP",
      });
    }
  });

  it("uses the part of the email before the @ as the name when there is no display name", async () => {
    backend({ me: ok({ ...USER, display_name: null }) });
    await renderHome();
    expect(mocks.userMenu).toHaveBeenCalledTimes(2);
    for (const [props] of mocks.userMenu.mock.calls) {
      expect(props.user).toEqual({
        name: "ana.perez",
        email: "ana.perez@example.com",
        initials: "A",
      });
    }
  });

  it("gives the menus no user when /me failed: a generic avatar, but the menus are still there", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    backend({ me: failure(502) });
    await renderHome();
    expect(headerMenu()).toBeTruthy();
    expect(sidebarMenu()).toBeTruthy();
    expect(mocks.userMenu).toHaveBeenCalledTimes(2);
    for (const [props] of mocks.userMenu.mock.calls) {
      expect(props.user).toBeUndefined();
    }
    logged.mockRestore();
  });

  it("names the space and its currency in the sidebar", async () => {
    await renderHome();
    const sidebar = within(document.querySelector("[data-slot='sidebar']") as HTMLElement);
    expect(sidebar.getByText("Mi espacio")).toBeTruthy();
    expect(sidebar.getByText("Peso uruguayo · UYU")).toBeTruthy();
  });

  it("has the main landmark and the name Kanza in the sidebar", async () => {
    await renderHome();
    expect(screen.getByRole("main")).toBeTruthy();
    // Since Escritorio v2 the logo is the icon (decorative) and the visible name, not an image
    // named "Kanza".
    expect(
      within(document.querySelector("[data-slot='sidebar']") as HTMLElement).getByText("Kanza"),
    ).toBeTruthy();
  });

  it("falls back to the part of the email before the @ when there is no display name", async () => {
    backend({ me: ok({ ...USER, display_name: null }) });
    await renderHome();
    expect(title()).toBe("Hola, ana.perez");
  });
  it("asks /me and /spaces once each, then what the dashboard needs, with one client", async () => {
    await renderHome();
    expect(mocks.getServerApi).toHaveBeenCalledTimes(1);
    expect(mocks.get.mock.calls.map(([path]) => path).sort()).toEqual([
      "/me",
      "/spaces",
      ACCOUNTS_PATH,
      DASHBOARD_PATH,
      SERIES_PATH,
      RECENT_PATH,
    ]);
  });

  it("starts the two calls of the shell before either one answers, and then the four of the dashboard together", async () => {
    const shell: Array<(value: unknown) => void> = [];
    const later: string[] = [];
    mocks.get.mockImplementation((path: string) => {
      if (path === "/me" || path === "/spaces") {
        return new Promise((resolve) => {
          shell.push(() => resolve(path === "/me" ? ok(USER) : ok([SPACE])));
        });
      }
      later.push(path);
      return new Promise((resolve) => {
        const answers: Record<string, unknown> = {
          [ACCOUNTS_PATH]: ok([]),
          [DASHBOARD_PATH]: ok(DASHBOARD),
          [SERIES_PATH]: ok(SERIES),
          [RECENT_PATH]: ok(RECENT),
        };
        resolve(answers[path]);
      });
    });
    const page = HomePage();
    await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    expect(shell).toHaveLength(2);
    // The rest needs the id of the space, so it waits for both answers.
    expect(later).toEqual([]);
    shell.forEach((answer) => answer(undefined));
    render(<QueryClientProvider client={new QueryClient()}>{await page}</QueryClientProvider>);
    expect(title()).toBe("Hola, Ana Pérez");
    expect(mocks.get).toHaveBeenCalledTimes(6);
    expect([...later].sort()).toEqual(
      [ACCOUNTS_PATH, DASHBOARD_PATH, RECENT_PATH, SERIES_PATH].sort(),
    );
  });

  it("starts the four calls of the dashboard before any of them answers", async () => {
    const waiting: string[] = [];
    mocks.get.mockImplementation((path: string) => {
      if (path === "/me") return Promise.resolve(ok(USER));
      if (path === "/spaces") return Promise.resolve(ok([SPACE]));
      waiting.push(path);
      return new Promise(() => {});
    });
    void HomePage();
    await vi.waitFor(() => expect(waiting).toHaveLength(4));
    expect([...waiting].sort()).toEqual(
      [ACCOUNTS_PATH, DASHBOARD_PATH, RECENT_PATH, SERIES_PATH].sort(),
    );
  });

  it("shows the first space when there are several", async () => {
    backend({ spaces: ok([SPACE, { ...SPACE, id: "s2", name: "Casa", type: "household" }]) });
    await renderHome();
    expect(mocks.currencyCard.mock.calls[0]?.[0].space.id).toBe("s1");
    const spaceIds = mocks.get.mock.calls
      .filter(([path]) => path !== "/me" && path !== "/spaces")
      .map(([, init]) => init.params.path.space_id);
    expect(spaceIds).toHaveLength(4);
    expect(new Set(spaceIds)).toEqual(new Set(["s1"]));
    expect(screen.queryByText("Casa")).toBeNull();
  });

  it("never shows the raw values of the backend", async () => {
    await renderHome();
    expect(screen.queryByText(/personal|household/)).toBeNull();
    expect(screen.queryByText(/\b(bank|cash|credit_card)\b/)).toBeNull();
    // The code of the currency shows up in one place only, inside its Spanish name (D17): not as a
    // bare "UYU" nor in any text such as "Moneda: UYU".
    expect(screen.queryAllByText(/UYU/).map((node) => node.textContent)).toEqual([
      "Peso uruguayo · UYU",
    ]);
  });

  it("holds very long names and emails without failing", async () => {
    const long = "x".repeat(120);
    backend({
      me: ok({ ...USER, display_name: null, email: `${long}@example.com` }),
      spaces: ok([{ ...SPACE, name: `${long} ${long}` }]),
    });
    await renderHome();
    expect(title()).toBe(`Hola, ${long}`);
  });

  describe("without a valid session", () => {
    it("goes to /login on a 401 from /me", async () => {
      backend({
        me: failure(401, { code: "not_authenticated", detail: "Not authenticated" }),
      });
      await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT /login");
      expect(mocks.redirect).toHaveBeenCalledWith("/login");
    });

    it("goes to /login on a 401 without a body, and on a 401 from /spaces", async () => {
      backend({ me: failure(401) });
      await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT /login");

      backend({ spaces: failure(401, { code: "invalid_session", detail: "Invalid session" }) });
      await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT /login");
    });

    it("goes to /login when one call is a 401 and the other fails otherwise, in both orders", async () => {
      const unauthorized = failure(401, { code: "invalid_session", detail: "Invalid session" });
      const broken = failure(500, { code: "internal_error", detail: "Internal Server Error" });
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});

      backend({ me: broken, spaces: unauthorized });
      await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT /login");

      backend({ me: unauthorized, spaces: broken });
      await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT /login");

      // A network failure on one side does not hide the 401 on the other either.
      mocks.get.mockImplementation(async (path: string) => {
        if (path === "/me") throw new TypeError("fetch failed");
        return unauthorized;
      });
      await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT /login");

      expect(mocks.redirect).toHaveBeenCalledTimes(3);
      expect(logged).not.toHaveBeenCalled();
      logged.mockRestore();
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

    it("shows the error in Spanish, never the English detail or the code", async () => {
      backend({
        spaces: failure(500, { code: "internal_error", detail: "Internal Server Error" }),
      });
      await renderHome();
      expect(screen.getByRole("alert").textContent).toContain("Algo salió mal de nuestro lado");
      expect(screen.queryByText(/Internal Server Error|internal_error/)).toBeNull();
      expect(screen.queryByText(/^Hola,/)).toBeNull();
      expect(mocks.redirect).not.toHaveBeenCalled();
    });

    it("offers to try again with a link to /", async () => {
      backend({ me: failure(502) });
      await renderHome();
      const retry = screen.getByText("Reintentar").closest("a");
      expect(retry?.getAttribute("href")).toBe("/");
    });

    it("shows a connection error when the backend does not answer", async () => {
      mocks.get.mockRejectedValue(new TypeError("fetch failed"));
      await renderHome();
      expect(screen.getByRole("alert").textContent).toContain("No pudimos conectar");
    });

    it("reports the first failure, /me before /spaces, when neither is a 401", async () => {
      const forbidden = failure(403, { code: "forbidden", detail: "Forbidden" });
      const broken = failure(500, { code: "internal_error", detail: "Internal Server Error" });

      backend({ me: forbidden, spaces: broken });
      const { unmount } = await renderHome();
      expect(screen.getByRole("alert").textContent).toContain("No tienes permiso para esto");
      unmount();

      backend({ me: broken, spaces: forbidden });
      await renderHome();
      expect(screen.getByRole("alert").textContent).toContain("Algo salió mal de nuestro lado");
      expect(mocks.redirect).not.toHaveBeenCalled();
    });

    it("logs only the kind of failure", async () => {
      backend({ me: failure(503, { code: "x", detail: "ana.perez@example.com" }) });
      await renderHome();
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged.mock.calls[0]?.[1]).toEqual({ status: 503 });
      expect(JSON.stringify(logged.mock.calls)).not.toContain("ana.perez");
    });

    it("logs only the name of an error that is not an ApiError, never its message", async () => {
      mocks.get.mockImplementation(async (path: string) => {
        if (path === "/me") {
          throw new SyntaxError("Unexpected token < in JSON at position 0: <html>secret");
        }
        return ok([SPACE]);
      });
      await renderHome();
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged).toHaveBeenCalledWith("Home: could not load /me and /spaces", {
        kind: "SyntaxError",
      });
      const everything = JSON.stringify(logged.mock.calls);
      expect(everything).not.toContain("secret");
      expect(everything).not.toContain("<html>");
      expect(everything).not.toContain("Unexpected token");
    });

    it("logs only the type of something that is not an Error", async () => {
      mocks.get.mockRejectedValue("secret body of the response");
      await renderHome();
      expect(logged).toHaveBeenCalledWith("Home: could not load /me and /spaces", {
        kind: "string",
      });
      expect(JSON.stringify(logged.mock.calls)).not.toContain("secret");
    });
  });

  describe("without spaces", () => {
    it("greets and says there is no space yet, and asks for no accounts", async () => {
      backend({ spaces: ok([]) });
      await renderHome();
      expect(title()).toBe("Hola, Ana Pérez");
      expect(screen.getByRole("status").textContent).toContain("Todavía no tienes un espacio");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(mocks.get.mock.calls.map(([path]) => path).sort()).toEqual(["/me", "/spaces"]);
      expect(mocks.currencyCard).not.toHaveBeenCalled();
    });
  });

  describe("the first use: no accounts yet", () => {
    it("invites to create the first one, with the grillo, the texts of the canvas and the button", async () => {
      await renderHome();
      const card = screen.getByRole("heading", { level: 2, name: "Empieza por tus cuentas" });
      expect(card).toBeTruthy();
      expect(
        screen.getByText(
          "Agrega dónde está tu dinero hoy: un banco, tu efectivo o una tarjeta. Con su saldo actual verás tu neto al instante.",
        ),
      ).toBeTruthy();
      const button = screen.getByRole("link", { name: "Crear mi primera cuenta" });
      // A real link to the page of the form: a phone goes there; from 1024 px a click opens the panel.
      expect(button.getAttribute("href")).toBe("/cuentas/nueva");
      expect(button.className).toContain("min-h-13");
      const grillo = document.querySelector("img[src*='kanza-symbol']");
      expect(grillo?.getAttribute("alt")).toBe("");
      expect(grillo?.className).toContain("size-30");
      expect(grillo?.className).toContain("lg:size-35");
      expect(screen.queryByText("Tus cuentas")).toBeNull();
    });

    it("also names the action in the sidebar: 'Nueva cuenta' leading to the same form", async () => {
      await renderHome();
      const sidebar = within(document.querySelector("[data-slot='sidebar']") as HTMLElement);
      expect(sidebar.getByRole("link", { name: "Nueva cuenta" }).getAttribute("href")).toBe(
        "/cuentas/nueva",
      );
    });

    it("shows the card of the currency next to it, with the space's id and currency", async () => {
      await renderHome();
      expect(screen.getByRole("region", { name: "Moneda de tu espacio" })).toBeTruthy();
      expect(mocks.currencyCard).toHaveBeenCalledTimes(1);
      expect(mocks.currencyCard.mock.calls[0]?.[0].space).toEqual({
        id: "s1",
        currency: { code: "UYU" },
      });
    });

    it("lays the two cards side by side from 1024 px, up to 1120 px", async () => {
      await renderHome();
      const row = screen.getByRole("main").firstElementChild as HTMLElement;
      for (const expected of ["lg:max-w-280", "lg:flex-row", "lg:flex-wrap"]) {
        expect(row.className).toContain(expected);
      }
      const [main, currency] = Array.from(row.children) as HTMLElement[];
      expect(main?.className).toContain("lg:basis-130");
      expect(main?.className).toContain("lg:grow-2");
      expect(currency?.className).toContain("lg:basis-70");
    });

    it("does not draw the card of the currency once the space has movements", async () => {
      backend({ spaces: ok([{ ...SPACE, currency_locked: true }]) });
      await renderHome();
      expect(screen.queryByRole("region", { name: "Moneda de tu espacio" })).toBeNull();
      expect(mocks.currencyCard).not.toHaveBeenCalled();
      // The invitation stays: the space can have movements and still no active account.
      expect(
        screen.getByRole("heading", { level: 2, name: "Empieza por tus cuentas" }),
      ).toBeTruthy();
    });
  });

  describe("with accounts: the dashboard", () => {
    beforeEach(() => backend({ accounts: ok([BANK, CASH, CARD]) }));

    it("draws the dashboard instead of the invitation", async () => {
      await renderHome();
      expect(screen.getByTestId("dashboard-screen")).toBeTruthy();
      expect(screen.queryByText("Empieza por tus cuentas")).toBeNull();
      expect(screen.queryByRole("region", { name: "Tus cuentas" })).toBeNull();
      expect(mocks.screen).toHaveBeenCalledTimes(1);
    });

    it("offers 'Registrar' in the sidebar, which opens the sheet over the screen", async () => {
      await renderHome();
      const sidebar = within(document.querySelector("[data-slot='sidebar']") as HTMLElement);
      expect(sidebar.getByRole("link", { name: "Registrar" }).getAttribute("href")).toBe(
        "/?movimiento=nuevo",
      );
      expect(sidebar.queryByRole("link", { name: "Nueva cuenta" })).toBeNull();
    });

    it("hands the screen the space, its month and its day, and nothing else of the data", async () => {
      await renderHome();
      expect(mocks.screen.mock.calls[0]?.[0]).toEqual({
        space: { id: "s1", currency: { code: "UYU", exponent: 2 } },
        currentMonth: expect.stringMatching(/^\d{4}-\d{2}$/),
        today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        currencyCard: expect.anything(),
      });
    });

    it("works out the month and the day in the space's time zone, not the server's", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        // 02:30 UTC of November 1st is still October 31st, 23:30, in Montevideo: the month changes
        // later for the space than for the server.
        vi.setSystemTime(new Date("2026-11-01T02:30:00Z"));
        await renderHome();
        expect(mocks.screen.mock.calls[0]?.[0]).toMatchObject({
          currentMonth: "2026-10",
          today: "2026-10-31",
        });
        // A space in another zone is already in November.
        mocks.screen.mockClear();
        backend({
          accounts: ok([BANK]),
          spaces: ok([{ ...SPACE, timezone: "Pacific/Auckland" }]),
        });
        cleanup();
        await renderHome();
        expect(mocks.screen.mock.calls[0]?.[0]).toMatchObject({
          currentMonth: "2026-11",
          today: "2026-11-01",
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("adds 'así va tu mes' to the date under the title, as the canvas has it", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date("2026-10-22T01:30:00Z"));
        await renderHome();
        const subtitle = screen.getByText("Miércoles 21 de octubre · así va tu mes");
        expect(subtitle.closest("header")).not.toBeNull();
        expect(subtitle.className).toContain("lg:block");
      } finally {
        vi.useRealTimers();
      }
    });

    it("asks for the dashboard, six months of series, six movements and the accounts with the archived ones", async () => {
      await renderHome();
      expect(mocks.get).toHaveBeenCalledWith(DASHBOARD_PATH, {
        params: { path: { space_id: "s1" } },
      });
      expect(mocks.get).toHaveBeenCalledWith(SERIES_PATH, {
        params: { path: { space_id: "s1" }, query: { months: 6 } },
      });
      // The latest movements of the whole history: six of them and no filter (not even the month).
      expect(mocks.get).toHaveBeenCalledWith(RECENT_PATH, {
        params: { path: { space_id: "s1" }, query: { limit: 6 } },
      });
      expect(mocks.get).toHaveBeenCalledWith(ACCOUNTS_PATH, {
        params: { path: { space_id: "s1" }, query: { include_archived: true } },
      });
    });

    it("hands the client what it prefetched, under the keys the screen reads", async () => {
      const { client } = await renderHome();
      expect(client.getQueryData(dashboardKey("s1"))).toEqual(DASHBOARD);
      expect(client.getQueryData(dashboardSeriesKey("s1", 6))).toEqual(SERIES);
      expect(client.getQueryData(recentTransactionsKey("s1"))).toEqual([MOVEMENT]);
      expect(client.getQueryData(accountsQueryKey("s1", { includeArchived: true }))).toEqual([
        BANK,
        CASH,
        CARD,
      ]);
    });

    it("keeps the card of the currency while the space has no movements, and drops it after", async () => {
      const { unmount } = await renderHome();
      expect(screen.getByRole("region", { name: "Moneda de tu espacio" })).toBeTruthy();
      expect(mocks.currencyCard).toHaveBeenCalledTimes(1);
      expect(mocks.currencyCard.mock.calls[0]?.[0].space).toEqual({
        id: "s1",
        currency: { code: "UYU" },
      });
      unmount();

      mocks.currencyCard.mockClear();
      mocks.screen.mockClear();
      backend({ spaces: ok([{ ...SPACE, currency_locked: true }]), accounts: ok([BANK]) });
      await renderHome();
      expect(screen.queryByRole("region", { name: "Moneda de tu espacio" })).toBeNull();
      expect(mocks.currencyCard).not.toHaveBeenCalled();
      expect(mocks.screen.mock.calls[0]?.[0].currencyCard).toBeNull();
    });

    it("does not draw the dashboard when only archived accounts are left: that is the first use", async () => {
      backend({ accounts: ok([{ ...BANK, archived_at: "2026-09-01T10:00:00Z" }]) });
      await renderHome();
      expect(screen.queryByTestId("dashboard-screen")).toBeNull();
      expect(
        screen.getByRole("heading", { level: 2, name: "Empieza por tus cuentas" }),
      ).toBeTruthy();
      const sidebar = within(document.querySelector("[data-slot='sidebar']") as HTMLElement);
      expect(sidebar.getByRole("link", { name: "Nueva cuenta" })).toBeTruthy();
    });

    it("never shows the raw values of the backend", async () => {
      await renderHome();
      expect(screen.queryByText(/personal|household/)).toBeNull();
      expect(screen.queryByText(/\b(bank|cash|credit_card)\b/)).toBeNull();
    });

    describe("when one of the three cards' requests fails", () => {
      let logged: ReturnType<typeof vi.spyOn>;

      beforeEach(() => {
        logged = vi.spyOn(console, "error").mockImplementation(() => {});
      });

      afterEach(() => {
        logged.mockRestore();
      });

      const BROKEN = failure(500, { code: "internal_error", detail: "Internal Server Error" });

      it.each([
        ["the dashboard", "dashboard", () => dashboardKey("s1")],
        ["the series", "series", () => dashboardSeriesKey("s1", 6)],
        ["the latest movements", "recent", () => recentTransactionsKey("s1")],
      ] as const)(
        "still draws the page without %s: that query is not hydrated and the card asks again",
        async (name, answer, key) => {
          backend({ accounts: ok([BANK]), [answer]: BROKEN });
          const { client } = await renderHome();
          expect(screen.getByTestId("dashboard-screen")).toBeTruthy();
          expect(title()).toBe("Hola, Ana Pérez");
          expect(client.getQueryData(key())).toBeUndefined();
          // The others did arrive.
          expect(client.getQueryData(accountsQueryKey("s1", { includeArchived: true }))).toEqual([
            BANK,
          ]);
          expect(logged).toHaveBeenCalledTimes(1);
          expect(logged).toHaveBeenCalledWith(`Home: could not load ${name}`, { status: 500 });
          expect(JSON.stringify(logged.mock.calls)).not.toContain("Internal Server Error");
          expect(mocks.redirect).not.toHaveBeenCalled();
        },
      );

      it("logs only the name of an error that is not an ApiError, never its message", async () => {
        mocks.get.mockImplementation(async (path: string) => {
          if (path === "/me") return ok(USER);
          if (path === "/spaces") return ok([SPACE]);
          if (path === ACCOUNTS_PATH) return ok([BANK]);
          throw new SyntaxError("Unexpected token < in JSON: <html>secret");
        });
        await renderHome();
        expect(logged).toHaveBeenCalledWith("Home: could not load the dashboard", {
          kind: "SyntaxError",
        });
        expect(JSON.stringify(logged.mock.calls)).not.toContain("secret");
        expect(screen.getByTestId("dashboard-screen")).toBeTruthy();
      });
    });

    describe("without a valid session", () => {
      const UNAUTHORIZED = failure(401, { code: "invalid_session", detail: "Invalid session" });

      it.each(["dashboard", "series", "recent", "accounts"] as const)(
        "goes to /login on a 401 from the %s",
        async (answer) => {
          const logged = vi.spyOn(console, "error").mockImplementation(() => {});
          backend({ accounts: ok([BANK]), [answer]: UNAUTHORIZED });
          await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT /login");
          expect(mocks.redirect).toHaveBeenCalledWith("/login");
          expect(logged).not.toHaveBeenCalled();
          logged.mockRestore();
        },
      );
    });
  });

  describe("when the accounts cannot be loaded", () => {
    let logged: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      logged = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      logged.mockRestore();
    });

    it("says so with a way to try again, and never shows them as 'no accounts'", async () => {
      backend({
        accounts: failure(500, { code: "internal_error", detail: "Internal Server Error" }),
      });
      await renderHome();
      expect(screen.getByRole("alert").textContent).toContain("Algo salió mal de nuestro lado");
      expect(screen.queryByText(/Internal Server Error|internal_error/)).toBeNull();
      expect(screen.getByText("Reintentar").closest("a")?.getAttribute("href")).toBe("/");
      expect(screen.queryByText("Empieza por tus cuentas")).toBeNull();
      expect(screen.queryByRole("link", { name: "Crear mi primera cuenta" })).toBeNull();
      expect(screen.queryByTestId("dashboard-screen")).toBeNull();
      expect(mocks.currencyCard).not.toHaveBeenCalled();
    });

    it("keeps 'Registrar' in the sidebar: a failed list is not 'no accounts'", async () => {
      backend({ accounts: failure(502) });
      await renderHome();
      const sidebar = within(document.querySelector("[data-slot='sidebar']") as HTMLElement);
      expect(sidebar.getByRole("link", { name: "Registrar" })).toBeTruthy();
    });

    it("keeps the greeting, the sidebar with the space and the account menus", async () => {
      backend({ accounts: failure(502) });
      await renderHome();
      expect(title()).toBe("Hola, Ana Pérez");
      const sidebar = within(document.querySelector("[data-slot='sidebar']") as HTMLElement);
      expect(sidebar.getByText("Peso uruguayo · UYU")).toBeTruthy();
      expect(screen.getAllByRole("button", { name: "Menú de la cuenta" })).toHaveLength(2);
    });

    it("shows a connection error when the call does not reach the backend", async () => {
      mocks.get.mockImplementation(async (path: string) => {
        if (path === "/me") return ok(USER);
        if (path === "/spaces") return ok([SPACE]);
        throw new TypeError("fetch failed");
      });
      await renderHome();
      expect(screen.getByRole("alert").textContent).toContain("No pudimos conectar");
    });

    it("logs only the kind of failure, never the message", async () => {
      backend({ accounts: failure(503, { code: "x", detail: "ana.perez@example.com" }) });
      await renderHome();
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged).toHaveBeenCalledWith("Home: could not load the accounts", { status: 503 });
      expect(JSON.stringify(logged.mock.calls)).not.toContain("ana.perez");

      logged.mockClear();
      mocks.get.mockImplementation(async (path: string) => {
        if (path === "/me") return ok(USER);
        if (path === "/spaces") return ok([SPACE]);
        throw new SyntaxError("Unexpected token < in JSON: <html>secret");
      });
      await renderHome();
      expect(logged).toHaveBeenCalledWith("Home: could not load the accounts", {
        kind: "SyntaxError",
      });
      expect(JSON.stringify(logged.mock.calls)).not.toContain("secret");
    });
  });
});

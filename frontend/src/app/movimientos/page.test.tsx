import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transactionsListKey, transactionsSummaryKey } from "@/lib/core/data/transactions";
import MovementsPage from "./page";

// The edges are mocked: the typed server client and the router. The screen and the line under the
// title (client islands with their own tests) are stand-ins that record what the page hands them.
// What is under test is the page's own logic: the 401 rule, the failures, what it prefetches (and
// that the client finds it under the same keys), the month and the day of the space, and the header.
const mocks = vi.hoisted(() => ({
  getServerApi: vi.fn(),
  get: vi.fn(),
  redirect: vi.fn(),
  screen: vi.fn(),
  subtitle: vi.fn(),
}));

vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/user-menu", () => ({ UserMenu: () => null }));
vi.mock("@/components/sidebar-nav", () => ({ SidebarNav: () => null }));
vi.mock("@/components/accounts/account-panel", () => ({ AccountPanelHost: () => null }));
vi.mock("@/components/movements/movement-panel", () => ({ MovementPanelHost: () => null }));
vi.mock("@/components/bottom-nav", () => ({ BottomNav: () => null }));
vi.mock("@/components/bfcache-guard", () => ({ BfcacheGuard: () => null }));
vi.mock("@/components/brand/brand-font", () => ({
  brandFont: { variable: "brand-font-variable" },
}));
vi.mock("./_components/movements-screen", () => ({
  MovementsScreen: (props: unknown) => {
    mocks.screen(props);
    return <div data-testid="movements-screen" />;
  },
}));
vi.mock("./_components/movements-subtitle", () => ({
  MovementsSubtitle: (props: unknown) => {
    mocks.subtitle(props);
    return <span data-testid="movements-subtitle" />;
  },
}));

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
  balance_minor: 0,
  archived_at: null,
  closing_day: null,
  due_day: null,
};
const MOVEMENT = {
  id: "m1",
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
const CATEGORY = {
  id: "c1",
  name: "Comida",
  kind: "expense",
  icon: "fork-knife",
  parent_id: null,
  archived_at: null,
};
const PAGE = { items: [MOVEMENT], next_cursor: null };
const SUMMARY = { count: 1, income_minor: 0, expense_minor: 234000, remaining_minor: -234000 };

const LIST_PATH = "/spaces/{space_id}/transactions";
const SUMMARY_PATH = "/spaces/{space_id}/transactions/summary";
const ACCOUNTS_PATH = "/spaces/{space_id}/accounts";
const CATEGORIES_PATH = "/spaces/{space_id}/categories";

const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) });
const failure = (status: number, body?: { code: string; detail: string }) => ({
  error: body,
  response: new Response(null, { status }),
});
const UNAUTHORIZED = failure(401, { code: "invalid_session", detail: "x" });
const BROKEN = failure(500, { code: "internal_error", detail: "boom" });

type Answers = Partial<
  Record<"me" | "spaces" | "list" | "summary" | "accounts" | "categories", unknown>
>;

function backend(answers: Answers = {}) {
  mocks.get.mockImplementation(async (path: string) => {
    if (path === "/me") return answers.me ?? ok(USER);
    if (path === "/spaces") return answers.spaces ?? ok([SPACE]);
    if (path === LIST_PATH) return answers.list ?? ok(PAGE);
    if (path === SUMMARY_PATH) return answers.summary ?? ok(SUMMARY);
    if (path === ACCOUNTS_PATH) return answers.accounts ?? ok([ACCOUNT]);
    if (path === CATEGORIES_PATH) return answers.categories ?? ok([CATEGORY]);
    throw new Error(`unexpected path ${path}`);
  });
}

async function renderPage(search: Record<string, string | string[] | undefined> = {}) {
  const client = new QueryClient();
  const ui = await MovementsPage({ searchParams: Promise.resolve(search) });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return client;
}

function callsTo(path: string) {
  return mocks.get.mock.calls.filter(([called]) => called === path).map(([, init]) => init);
}

beforeEach(() => {
  // A fixed "now": 29 October 2026, 15:00 UTC, still the 29th in Montevideo (UTC-3).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-29T15:00:00Z"));
  mocks.getServerApi.mockReset().mockResolvedValue({ GET: mocks.get });
  mocks.get.mockReset();
  mocks.screen.mockReset();
  mocks.subtitle.mockReset();
  mocks.redirect.mockReset().mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  });
  backend();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("MovementsPage", () => {
  it("titles the screen Movimientos", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Movimientos");
  });

  it("asks for the current month of the space, 50 movements and the summary of the same month", async () => {
    await renderPage();
    expect(callsTo(LIST_PATH)).toEqual([
      { params: { path: { space_id: "s1" }, query: { month: "2026-10", limit: 50 } } },
    ]);
    expect(callsTo(SUMMARY_PATH)).toEqual([
      { params: { path: { space_id: "s1" }, query: { month: "2026-10" } } },
    ]);
  });

  it("asks for the accounts with the archived ones: the screen needs to know if there is one to register on", async () => {
    await renderPage();
    expect(callsTo(ACCOUNTS_PATH)).toEqual([
      { params: { path: { space_id: "s1" }, query: { include_archived: true } } },
    ]);
  });

  it("asks for the categories with the archived ones too: the filter offers them", async () => {
    await renderPage();
    expect(callsTo(CATEGORIES_PATH)).toEqual([
      { params: { path: { space_id: "s1" }, query: { include_archived: true } } },
    ]);
  });

  it("takes the filters from the URL, so the first page is already the one that was asked for", async () => {
    await renderPage({ mes: "2026-08", tipo: "gastos", q: "uber" });
    const query = { month: "2026-08", type: "expense", q: "uber" };
    expect(callsTo(LIST_PATH)[0]).toEqual({
      params: { path: { space_id: "s1" }, query: { ...query, limit: 50 } },
    });
    expect(callsTo(SUMMARY_PATH)[0]).toEqual({ params: { path: { space_id: "s1" }, query } });
  });

  it("ignores what the URL says wrong, instead of sending a request the backend would refuse", async () => {
    await renderPage({
      mes: "2026-13",
      tipo: ["x", "gastos"],
      cuenta_id: "no-es-un-uuid",
      categoria_id: "tampoco",
      q: "   ",
    });
    expect(callsTo(LIST_PATH)[0]).toEqual({
      params: { path: { space_id: "s1" }, query: { month: "2026-10", limit: 50 } },
    });
  });

  it("hydrates the client with the list, the summary, the accounts and the categories under the keys it will ask with", async () => {
    const client = await renderPage({ tipo: "ingresos" });
    const filters = { month: "2026-10", type: "income" as const };
    expect(client.getQueryData(transactionsListKey("s1", filters))).toEqual({
      pages: [PAGE],
      pageParams: [null],
    });
    expect(client.getQueryData(transactionsSummaryKey("s1", filters))).toEqual(SUMMARY);
    expect(client.getQueryData(["spaces", "s1", "accounts", { includeArchived: true }])).toEqual([
      ACCOUNT,
    ]);
    expect(client.getQueryData(["spaces", "s1", "categories", { includeArchived: true }])).toEqual([
      CATEGORY,
    ]);
  });

  it("hands the screen the space, its current month and its day: the zone of the space, not the device's", async () => {
    await renderPage();
    expect(mocks.screen).toHaveBeenCalledWith({
      space: { id: "s1", currency: { code: "UYU", exponent: 2 } },
      currentMonth: "2026-10",
      today: "2026-10-29",
    });
  });

  it("uses the month and the day of the zone near midnight: 01:30 UTC of 1 November is still 31 October in Montevideo", async () => {
    vi.setSystemTime(new Date("2026-11-01T01:30:00Z"));
    await renderPage();
    expect(mocks.screen).toHaveBeenCalledWith(
      expect.objectContaining({ currentMonth: "2026-10", today: "2026-10-31" }),
    );
    expect(callsTo(LIST_PATH)[0]).toEqual({
      params: { path: { space_id: "s1" }, query: { month: "2026-10", limit: 50 } },
    });
  });

  it("puts the line under the title in the header, with the space and the month", async () => {
    await renderPage();
    expect(mocks.subtitle).toHaveBeenCalledWith({ spaceId: "s1", currentMonth: "2026-10" });
    const subtitle = screen.getByTestId("movements-subtitle");
    expect(subtitle.closest("header")).not.toBeNull();
    expect(subtitle.parentElement!.className).toContain("lg:block");
  });

  it("has the magnifier in the header, for a phone, closed at first", async () => {
    await renderPage();
    const magnifier = within(screen.getByRole("banner")).getByRole("button", {
      name: "Buscar",
    });
    expect(magnifier.className).toContain("lg:hidden");
    expect(magnifier.getAttribute("aria-expanded")).toBe("false");
  });

  it("has 'Registrar movimiento' in the header, a link that opens the sheet", async () => {
    await renderPage();
    const action = within(screen.getByRole("banner")).getByRole("link", {
      name: "Registrar movimiento",
    });
    expect(action.getAttribute("href")).toBe("/?movimiento=nuevo");
    // From 1024 px only: below it the bottom bar has the "+".
    expect(action.className).toContain("hidden");
    expect(action.className).toContain("lg:inline-flex");
  });

  it("says 'Nueva cuenta' in the header and the shell when the accounts loaded and none is active", async () => {
    backend({ accounts: ok([{ ...ACCOUNT, archived_at: "2026-09-01T12:00:00Z" }]) });
    await renderPage();
    const action = within(screen.getByRole("banner")).getByRole("link", { name: "Nueva cuenta" });
    expect(action.getAttribute("href")).toBe("/cuentas/nueva");
    const sidebar = within(document.querySelector("[data-slot='sidebar']") as HTMLElement);
    expect(sidebar.getByRole("link", { name: "Nueva cuenta" })).toBeTruthy();
  });

  it("keeps 'Registrar' when the accounts did not load: a failed list is never taken for 'no accounts'", async () => {
    backend({ accounts: BROKEN });
    await renderPage();
    const sidebar = within(document.querySelector("[data-slot='sidebar']") as HTMLElement);
    expect(sidebar.getByRole("link", { name: "Registrar" })).toBeTruthy();
    expect(
      within(screen.getByRole("banner")).getByRole("link", { name: "Registrar movimiento" }),
    ).toBeTruthy();
  });

  it.each([
    ["/me", { me: UNAUTHORIZED }],
    ["/spaces", { spaces: UNAUTHORIZED }],
    ["the movements", { list: UNAUTHORIZED }],
    ["the summary", { summary: UNAUTHORIZED }],
    ["the accounts", { accounts: UNAUTHORIZED }],
    ["the categories", { categories: UNAUTHORIZED }],
  ])("goes to /login on a 401 from %s", async (_name, answers) => {
    backend(answers);
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it("shows an Alert with Reintentar, and no screen, when /me or /spaces fail", async () => {
    backend({ me: BROKEN });
    await renderPage();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Reintentar").closest("a")?.getAttribute("href")).toBe("/movimientos");
    expect(screen.queryByTestId("movements-screen")).toBeNull();
    expect(mocks.get).not.toHaveBeenCalledWith(LIST_PATH, expect.anything());
  });

  it.each([
    ["the movements", { list: BROKEN }],
    ["the summary", { summary: BROKEN }],
    ["the accounts", { accounts: BROKEN }],
    ["the categories", { categories: BROKEN }],
  ])(
    "leaves a failure of %s to the screen: no Alert, nothing hydrated for it",
    async (_name, answers) => {
      backend(answers);
      const client = await renderPage();
      expect(screen.getByTestId("movements-screen")).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
      const key =
        "list" in answers
          ? transactionsListKey("s1", { month: "2026-10" })
          : "summary" in answers
            ? transactionsSummaryKey("s1", { month: "2026-10" })
            : "categories" in answers
              ? ["spaces", "s1", "categories", { includeArchived: true }]
              : ["spaces", "s1", "accounts", { includeArchived: true }];
      expect(client.getQueryData(key)).toBeUndefined();
    },
  );

  it("shows a notice when there is no space", async () => {
    backend({ spaces: ok([]) });
    await renderPage();
    expect(screen.getByText("Todavía no tienes un espacio")).toBeTruthy();
    expect(screen.queryByTestId("movements-screen")).toBeNull();
  });

  it("asks for the movements, the summary, the accounts and the categories in parallel, after /me and /spaces", async () => {
    const started: string[] = [];
    mocks.get.mockImplementation(async (path: string) => {
      started.push(path);
      if (path === "/me") return ok(USER);
      if (path === "/spaces") return ok([SPACE]);
      // Nothing answers until all three are on their way: a chain would never get past the first.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (path === LIST_PATH) return ok(PAGE);
      if (path === SUMMARY_PATH) return ok(SUMMARY);
      if (path === ACCOUNTS_PATH) return ok([ACCOUNT]);
      return ok([CATEGORY]);
    });
    vi.useRealTimers();
    await renderPage();
    expect(started.slice(0, 2).sort()).toEqual(["/me", "/spaces"]);
    expect(new Set(started.slice(2))).toEqual(
      new Set([LIST_PATH, SUMMARY_PATH, ACCOUNTS_PATH, CATEGORIES_PATH]),
    );
  });

  it("logs only the kind of failure, never its message", async () => {
    backend({ me: failure(500, { code: "internal_error", detail: "secret detail" }) });
    await renderPage();
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain("500");
    expect(logged).not.toContain("secret detail");
    backend({ list: failure(500, { code: "internal_error", detail: "another secret" }) });
    await renderPage();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("another secret");
  });
});

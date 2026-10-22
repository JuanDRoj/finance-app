import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import { AccountsScreen } from "./accounts-screen";

// The edges are mocked: the scripted API client, the router, the URL, the width and the toast. The
// screen, its groups, rows, archived section and detail are the real ones.
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  desktop: false,
  search: "",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("@/components/use-is-desktop", () => ({
  DESKTOP_MEDIA_QUERY: "(min-width: 64rem)",
  useIsDesktop: () => mocks.desktop,
}));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

const SPACE = { id: "space-1", currency: { code: "UYU", exponent: 2 } };
const API = { GET: mocks.get, POST: mocks.post } as unknown as ApiClient;

function account(overrides: Partial<AccountWithBalance>): AccountWithBalance {
  return {
    id: "a1",
    name: "Itaú",
    type: "bank",
    closing_day: null,
    due_day: null,
    archived_at: null,
    balance_minor: 8425000,
    ...overrides,
  };
}
const ITAU = account({});
const EFECTIVO = account({ id: "a2", name: "Efectivo", type: "cash", balance_minor: 550000 });
const VISA = account({
  id: "a3",
  name: "Visa Itaú",
  type: "credit_card",
  closing_day: 5,
  due_day: 12,
  balance_minor: -2412000,
});
const OLD = account({
  id: "a4",
  name: "Billetera vieja",
  type: "cash",
  balance_minor: 0,
  archived_at: "2026-09-01T10:00:00Z",
});

function ok(data: unknown) {
  return { data, response: new Response(null, { status: 200 }) };
}
function failure(status: number, body?: unknown) {
  return { error: body, response: new Response(null, { status }) };
}

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue(ok([ITAU, EFECTIVO, VISA, OLD]));
  mocks.post.mockReset().mockResolvedValue(ok({ ...OLD, archived_at: null }));
  mocks.refresh.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  mocks.desktop = false;
  mocks.search = "";
});

function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const ui = () => (
    <QueryClientProvider client={queryClient}>
      <AccountsScreen space={SPACE} api={API} />
    </QueryClientProvider>
  );
  const view = render(ui());
  return { ...view, invalidate, again: () => view.rerender(ui()) };
}

/** The screen with its data on it. */
async function renderLoaded() {
  const view = renderScreen();
  await screen.findByRole("heading", { name: "Disponible" });
  return view;
}

describe("AccountsScreen states", () => {
  it("shows a skeleton while the accounts load", async () => {
    mocks.get.mockReturnValue(new Promise(() => {}));
    renderScreen();
    expect(screen.getByRole("status", { name: "Cargando cuentas" })).toBeTruthy();
  });

  it("asks for the archived accounts too, in one request", async () => {
    await renderLoaded();
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get.mock.calls[0]![1]).toMatchObject({
      params: { path: { space_id: "space-1" }, query: { include_archived: true } },
    });
  });

  it("shows an error with Reintentar, never 'no accounts', and recovers when asking again", async () => {
    mocks.get.mockResolvedValueOnce(failure(500, { code: "internal_error", detail: "boom" }));
    renderScreen();
    expect(await screen.findByText("No se pudieron cargar tus cuentas")).toBeTruthy();
    expect(screen.queryByText("Aún no tienes cuentas")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { name: "Disponible" })).toBeTruthy();
    expect(screen.queryByText("No se pudieron cargar tus cuentas")).toBeNull();
  });

  it("shows the empty state, with a way to create the first account, when there are none", async () => {
    mocks.get.mockResolvedValue(ok([]));
    renderScreen();
    expect(await screen.findByRole("heading", { name: "Aún no tienes cuentas" })).toBeTruthy();
    const create = screen.getByRole("link", { name: "Crear cuenta" });
    expect(create.getAttribute("href")).toBe("/cuentas/nueva");
    expect(screen.queryByRole("button", { name: /Archivadas/ })).toBeNull();
  });

  it("shows the empty state above the archived accounts when only those exist", async () => {
    mocks.get.mockResolvedValue(ok([OLD]));
    renderScreen();
    expect(await screen.findByRole("heading", { name: "Aún no tienes cuentas" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archivadas (1)" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Disponible" })).toBeNull();
  });
});

describe("AccountsScreen list", () => {
  it("groups bank and cash under Disponible and the cards under Deuda, with their totals", async () => {
    await renderLoaded();
    const available = within(screen.getByRole("region", { name: "Disponible" }));
    expect(available.getByText("$ 89.750,00")).toBeTruthy(); // the total: 84.250 + 5.500
    expect(available.getByText("Itaú")).toBeTruthy();
    expect(available.getAllByText("Efectivo")).toHaveLength(2); // its name and its type
    const debt = within(screen.getByRole("region", { name: "Deuda" }));
    expect(debt.getAllByText("$ 24.120,00")).toHaveLength(2); // the total and the card's row
    expect(debt.getByText("Cierra el 5 · vence el 12")).toBeTruthy();
  });

  it("paints the debt of a card, its total and its row in the debt color", async () => {
    await renderLoaded();
    const debt = within(screen.getByRole("region", { name: "Deuda" }));
    for (const amount of debt.getAllByText("$ 24.120,00")) {
      expect(amount.className).toContain("text-debt");
    }
    expect(
      within(screen.getByRole("region", { name: "Disponible" })).getByText("$ 89.750,00").className,
    ).not.toContain("text-debt");
  });

  it("omits the group that has no accounts", async () => {
    mocks.get.mockResolvedValue(ok([ITAU]));
    renderScreen();
    await screen.findByRole("heading", { name: "Disponible" });
    expect(screen.queryByRole("heading", { name: "Deuda" })).toBeNull();
  });

  it("does not list the archived accounts in the groups", async () => {
    await renderLoaded();
    expect(
      within(screen.getByRole("region", { name: "Disponible" })).queryByText("Billetera vieja"),
    ).toBeNull();
  });

  it("shows an overpaid card as a negative debt instead of hiding it", async () => {
    mocks.get.mockResolvedValue(ok([ITAU, { ...VISA, balance_minor: 40000 }]));
    renderScreen();
    await screen.findByRole("heading", { name: "Deuda" });
    expect(screen.getAllByText("−$ 400,00").length).toBeGreaterThan(0);
  });

  it("holds the long names and the biggest amounts: the name is cut and complete in `title`", async () => {
    const long = "Cuenta sueldo ".repeat(6).trim().slice(0, 80);
    const noSpaces = "x".repeat(80);
    mocks.get.mockResolvedValue(
      ok([
        account({ name: long, balance_minor: 9007199254740991 }),
        account({ id: "a9", name: noSpaces, balance_minor: 9007199254740991 }),
      ]),
    );
    renderScreen();
    await screen.findByRole("heading", { name: "Disponible" });
    for (const name of [long, noSpaces]) {
      const label = screen.getAllByText(name).find((node) => node.className.includes("truncate"))!;
      expect(label.className).toContain("truncate");
      expect(label.getAttribute("title")).toBe(name);
    }
    // A balance is never cut: it can wrap, but it is not truncated nor kept from shrinking.
    for (const amount of screen.getAllByText("$ 90.071.992.547.409,91")) {
      expect(amount.className).not.toContain("truncate");
      expect(amount.className).toContain("break-all");
    }
    // 2 × 9007199254740991 is past the safe integers, and still exact.
    expect(screen.getByText("$ 180.143.985.094.819,82")).toBeTruthy();
  });

  it("works with the currencies that have no decimals, or three", async () => {
    mocks.get.mockResolvedValue(ok([account({ balance_minor: 1500 })]));
    const view = render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AccountsScreen space={{ id: "s2", currency: { code: "COP", exponent: 0 } }} api={API} />
      </QueryClientProvider>,
    );
    expect((await view.findAllByText("$ 1.500")).length).toBeGreaterThan(0);
  });
});

describe("AccountsScreen archived accounts", () => {
  it("folds 'Archivadas (n)' and opens it with aria-expanded", async () => {
    await renderLoaded();
    const toggle = screen.getByRole("button", { name: "Archivadas (1)" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Desarchivar Billetera vieja" })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Desarchivar Billetera vieja" })).toBeTruthy();
    expect(screen.getByText("$ 0,00")).toBeTruthy();
  });

  it("unarchives with no confirmation: POST, invalidates the space, refreshes and says so", async () => {
    const { invalidate } = await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Archivadas (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Desarchivar Billetera vieja" }));
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Desarchivaste «Billetera vieja»"),
    );
    expect(mocks.post).toHaveBeenCalledWith("/spaces/{space_id}/accounts/{account_id}/unarchive", {
      params: { path: { space_id: "space-1", account_id: "a4" } },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["spaces", "space-1"] });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  });

  it("explains a failure in Spanish and keeps the account archived", async () => {
    mocks.post.mockResolvedValue(failure(404, { code: "account_not_found", detail: "x" }));
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Archivadas (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Desarchivar Billetera vieja" }));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("No encontramos esa cuenta", expect.anything()),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("AccountsScreen detail and selection", () => {
  it("has plain rows below 1024 px, because the page of an account is not there yet", async () => {
    await renderLoaded();
    const lists = [
      screen.getByRole("region", { name: "Disponible" }),
      screen.getByRole("region", { name: "Deuda" }),
    ];
    for (const list of lists) expect(within(list).queryByRole("link")).toBeNull();
  });

  it("makes the rows links from 1024 px and picks the first account when ?sel is missing", async () => {
    mocks.desktop = true;
    await renderLoaded();
    const itau = screen.getByRole("link", { name: /^Itaú/ });
    expect(itau.getAttribute("href")).toBe("/cuentas?sel=a1");
    expect(itau.getAttribute("aria-current")).toBe("true");
    expect(
      screen.getByRole("link", { name: /^Visa Itaú/ }).getAttribute("aria-current"),
    ).toBeNull();
    const detail = within(screen.getByRole("region", { name: "Itaú" }));
    expect(detail.getByText("Saldo de hoy")).toBeTruthy();
    expect(detail.getByText("$ 84.250,00")).toBeTruthy();
  });

  it("shows a card's debt in the detail, with its days", async () => {
    mocks.desktop = true;
    mocks.search = "sel=a3";
    await renderLoaded();
    const detail = within(screen.getByRole("region", { name: "Visa Itaú" }));
    expect(detail.getByText("Tarjeta · cierra el 5 · vence el 12")).toBeTruthy();
    expect(detail.getByText("Deuda de hoy")).toBeTruthy();
    expect(detail.getByText("$ 24.120,00").className).toContain("text-debt");
  });

  it.each([
    ["archived", "sel=a4"],
    ["unknown", "sel=nope"],
    ["empty", ""],
  ])("falls back to the first active account when ?sel is %s", async (_name, search) => {
    mocks.desktop = true;
    mocks.search = search;
    await renderLoaded();
    expect(screen.getByRole("region", { name: "Itaú" })).toBeTruthy();
  });

  it("a plain click writes ?sel with replaceState instead of navigating", async () => {
    mocks.desktop = true;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    const { again } = await renderLoaded();
    const replace = vi.spyOn(window.history, "replaceState");
    const push = vi.spyOn(window.history, "pushState");
    const visa = screen.getByRole("link", { name: /^Visa Itaú/ });
    const notPrevented = fireEvent.click(visa);
    expect(notPrevented).toBe(false);
    expect(replace).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?sel=a3");
    // Next integrates `replaceState` with `useSearchParams`; the test follows the address bar.
    mocks.search = window.location.search;
    again();
    expect(screen.getByRole("region", { name: "Visa Itaú" })).toBeTruthy();
  });

  it("leaves a modified click to the browser", async () => {
    mocks.desktop = true;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    await renderLoaded();
    const visa = screen.getByRole("link", { name: /^Visa Itaú/ });
    expect(fireEvent.click(visa, { ctrlKey: true })).toBe(true);
    expect(fireEvent.click(visa, { metaKey: true })).toBe(true);
    expect(fireEvent.click(visa, { button: 1 })).toBe(true);
    expect(window.location.search).toBe("");
  });

  it("does not hijack the click when the window was narrowed since the render", async () => {
    mocks.desktop = true;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    await renderLoaded();
    expect(fireEvent.click(screen.getByRole("link", { name: /^Visa Itaú/ }))).toBe(true);
    expect(window.location.search).toBe("");
  });

  it("hides the detail from phones with CSS (it is in the DOM, `hidden lg:flex`)", async () => {
    await renderLoaded();
    expect(screen.getByRole("region", { name: "Itaú", hidden: true }).className).toContain(
      "hidden",
    );
  });
});

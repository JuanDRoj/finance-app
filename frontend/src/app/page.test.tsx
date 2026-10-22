import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpaceRead } from "@/lib/core/data/spaces";
import type { UserRead } from "@/lib/core/data/me";
import HomePage from "./page";

// The edges of the screen are mocked: the typed API client (with the session cookie) and the
// router. What is under test is the page's own logic: the greeting, the fallback of the name, the
// 401 redirect and the error and empty states.
const mocks = vi.hoisted(() => ({
  getServerApi: vi.fn(),
  get: vi.fn(),
  redirect: vi.fn(),
  userMenu: vi.fn(),
  currencyCard: vi.fn(),
}));

vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
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
vi.mock("@/components/currency/currency-card", () => ({
  CurrencyCard: (props: { space: { id: string; currency: { code: string } } }) => {
    mocks.currencyCard(props);
    return <section aria-label="Moneda de tu espacio" />;
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

function ok(data: unknown) {
  return { data, response: new Response(null, { status: 200 }) };
}

function failure(status: number, body?: { code: string; detail: string }) {
  return { error: body, response: new Response(null, { status }) };
}

/** What the three calls answer; each test overrides what it needs. No accounts unless it says so. */
function backend(answers: { me?: unknown; spaces?: unknown; accounts?: unknown }) {
  mocks.get.mockImplementation(async (path: string) => {
    if (path === "/me") return answers.me ?? ok(USER);
    if (path === "/spaces") return answers.spaces ?? ok([SPACE]);
    if (path === "/spaces/{space_id}/accounts") return answers.accounts ?? ok([]);
    throw new Error(`unexpected path ${path}`);
  });
}

async function renderHome() {
  return render(await HomePage());
}

beforeEach(() => {
  mocks.getServerApi.mockReset().mockResolvedValue({ GET: mocks.get });
  mocks.get.mockReset();
  mocks.userMenu.mockReset();
  mocks.currencyCard.mockReset();
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

  it("asks /me and /spaces once each, then the accounts of the space, with one client", async () => {
    await renderHome();
    expect(mocks.getServerApi).toHaveBeenCalledTimes(1);
    expect(mocks.get.mock.calls.map(([path]) => path).sort()).toEqual([
      "/me",
      "/spaces",
      "/spaces/{space_id}/accounts",
    ]);
    // The active ones only: the backend hides the archived by default, so no query is sent.
    expect(mocks.get).toHaveBeenLastCalledWith("/spaces/{space_id}/accounts", {
      params: { path: { space_id: "s1" } },
    });
  });

  it("starts both calls before either one answers", async () => {
    const pending: Array<(value: unknown) => void> = [];
    mocks.get.mockImplementation(
      (path: string) =>
        new Promise((resolve) => {
          if (path === "/spaces/{space_id}/accounts") return resolve(ok([]));
          pending.push((value) => resolve(value ?? (path === "/me" ? ok(USER) : ok([SPACE]))));
        }),
    );
    const page = HomePage();
    await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    expect(pending).toHaveLength(2);
    // The accounts need the id of the space, so they wait for both answers.
    expect(mocks.get).not.toHaveBeenCalledWith("/spaces/{space_id}/accounts", expect.anything());
    pending.forEach((answer) => answer(undefined));
    render(await page);
    expect(title()).toBe("Hola, Ana Pérez");
    expect(mocks.get).toHaveBeenCalledTimes(3);
  });

  it("shows the first space when there are several", async () => {
    backend({ spaces: ok([SPACE, { ...SPACE, id: "s2", name: "Casa", type: "household" }]) });
    await renderHome();
    expect(mocks.currencyCard.mock.calls[0]?.[0].space.id).toBe("s1");
    expect(mocks.get).toHaveBeenLastCalledWith("/spaces/{space_id}/accounts", {
      params: { path: { space_id: "s1" } },
    });
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

  describe("with accounts", () => {
    beforeEach(() => backend({ accounts: ok([BANK, CASH, CARD]) }));

    it("lists them under 'Tus cuentas' instead of the invitation", async () => {
      await renderHome();
      const region = screen.getByRole("region", { name: "Tus cuentas" });
      const rows = within(region).getAllByRole("listitem");
      expect(rows).toHaveLength(3);
      expect(
        rows.map((row) => within(row).getByText(/^(Itaú|Billetera|Visa Itaú)$/).textContent),
      ).toEqual(["Itaú", "Billetera", "Visa Itaú"]);
      expect(screen.queryByText("Empieza por tus cuentas")).toBeNull();
      expect(screen.queryByRole("link", { name: "Crear mi primera cuenta" })).toBeNull();
    });

    it("names the type in Spanish and, for a card, the days it closes and is due", async () => {
      await renderHome();
      const [bank, cash, card] = within(
        screen.getByRole("region", { name: "Tus cuentas" }),
      ).getAllByRole("listitem");
      expect(bank?.textContent).toContain("Banco");
      expect(cash?.textContent).toContain("Efectivo");
      expect(card?.textContent).toContain("Cierra el 5 · vence el 12");
      expect(card?.textContent).not.toContain("Tarjeta");
    });

    it("writes each balance in the space's currency, and a card by what it owes in the debt color", async () => {
      await renderHome();
      const [bank, cash, card] = within(
        screen.getByRole("region", { name: "Tus cuentas" }),
      ).getAllByRole("listitem");
      // Intl puts a no-break space after the symbol; Testing Library's text has it as a plain one.
      expect(bank?.textContent).toContain("$\u00A01.550,50");
      expect(cash?.textContent).toContain("$\u00A05.500,00");
      // `balance_minor` is -2412000 (it owes): shown positive.
      expect(card?.textContent).toContain("$\u00A024.120,00");
      expect(card?.textContent).not.toContain("\u2212");
      expect(within(card as HTMLElement).getByText(/24\.120,00/).className).toContain("text-debt");
      expect(within(bank as HTMLElement).getByText(/1\.550,50/).className).not.toContain(
        "text-debt",
      );
    });

    it("writes a negative balance with the typographic minus, and a card paid in excess too", async () => {
      backend({
        accounts: ok([
          { ...BANK, balance_minor: -25075 },
          { ...CARD, balance_minor: 10000 },
        ]),
      });
      await renderHome();
      const [bank, card] = within(screen.getByRole("region", { name: "Tus cuentas" })).getAllByRole(
        "listitem",
      );
      expect(bank?.textContent).toContain("\u2212$\u00A0250,75");
      expect(card?.textContent).toContain("\u2212$\u00A0100,00");
    });

    it("uses the currency of the space: dollars say 'US$'", async () => {
      backend({
        spaces: ok([{ ...SPACE, currency: { code: "USD", exponent: 2 } }]),
        accounts: ok([BANK]),
      });
      await renderHome();
      expect(screen.getByRole("region", { name: "Tus cuentas" }).textContent).toContain(
        "US$\u00A01.550,50",
      );
    });

    it("makes each row a link to Cuentas with that account chosen", async () => {
      await renderHome();
      const region = within(screen.getByRole("region", { name: "Tus cuentas" }));
      const hrefs = region.getAllByRole("link").map((link) => link.getAttribute("href"));
      expect(hrefs).toEqual([BANK, CASH, CARD].map((account) => `/cuentas?sel=${account.id}`));
    });

    it("cuts a very long name with an ellipsis instead of breaking the row", async () => {
      const long = "Cuenta ".repeat(40).trim();
      backend({ accounts: ok([{ ...BANK, name: long }]) });
      await renderHome();
      expect(screen.getByText(long).className).toContain("truncate");
    });

    it("holds a balance at the limit of the backend", async () => {
      backend({ accounts: ok([{ ...BANK, balance_minor: Number.MAX_SAFE_INTEGER }]) });
      await renderHome();
      expect(screen.getByText(/90\.071\.992\.547\.409,91/)).toBeTruthy();
    });

    it("keeps the card of the currency while the space has no movements, and drops it after", async () => {
      const { unmount } = await renderHome();
      expect(screen.getByRole("region", { name: "Moneda de tu espacio" })).toBeTruthy();
      unmount();

      backend({ spaces: ok([{ ...SPACE, currency_locked: true }]), accounts: ok([BANK]) });
      await renderHome();
      expect(screen.queryByRole("region", { name: "Moneda de tu espacio" })).toBeNull();
      expect(screen.getByRole("region", { name: "Tus cuentas" })).toBeTruthy();
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
      expect(mocks.currencyCard).not.toHaveBeenCalled();
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

    it("goes to /login on a 401 from the accounts", async () => {
      backend({ accounts: failure(401, { code: "invalid_session", detail: "Invalid session" }) });
      await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT /login");
      expect(mocks.redirect).toHaveBeenCalledWith("/login");
      expect(logged).not.toHaveBeenCalled();
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

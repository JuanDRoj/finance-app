import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EFECTIVO,
  ITAU,
  VISA,
  incomeItem,
  movementItem,
  transferItem,
} from "@/components/movements/movement-fixtures";
import {
  scriptedMovementsApi,
  type Fault,
  type ScriptedCall,
  type ScriptedMovementsApi,
} from "@/components/movements/scripted-movements-api";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import type { CategoryRead } from "@/lib/core/data/categories";
import type { MovementListItem } from "@/lib/core/data/transactions";
import { MovementsScreen } from "./movements-screen";
import { PHONE_SEARCH_INPUT_ID, SEARCH_DEBOUNCE_MS, SEARCH_TOGGLE_ID } from "./search-box";
import { SearchToggle } from "./search-toggle";

// The screen runs for real (the filters in the URL, the queries, the lists, the states) against a
// scripted backend that filters, pages by cursor and adds up the summary like the real one. CSS is
// not applied in jsdom, so the phone's list and the table are both in the page, and so are the
// filters' card and the phone's controls: a test picks the one it means by its place.
vi.mock("next/navigation", () => ({
  // The address bar, as Next sees it: a write with `replaceState` re-renders who reads it.
  useSearchParams: () => {
    const search = useSyncExternalStore(
      (notify) => {
        window.addEventListener("test-url-changed", notify);
        return () => window.removeEventListener("test-url-changed", notify);
      },
      () => window.location.search,
      () => "",
    );
    return new URLSearchParams(search);
  },
}));

class FakeObserver {
  static all: FakeObserver[] = [];
  disconnected = false;
  constructor(private callback: IntersectionObserverCallback) {
    FakeObserver.all.push(this);
  }
  observe() {}
  disconnect() {
    this.disconnected = true;
  }
  report(isIntersecting: boolean) {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this as never);
  }
  static get live() {
    return FakeObserver.all.filter((observer) => !observer.disconnected);
  }
}

const replaceState = window.history.replaceState.bind(window.history);
let desktop = false;

beforeEach(() => {
  desktop = false;
  FakeObserver.all = [];
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: desktop, media: query }));
  window.history.replaceState = (...args: Parameters<History["replaceState"]>) => {
    replaceState(...args);
    window.dispatchEvent(new Event("test-url-changed"));
  };
});

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState = replaceState;
  replaceState(null, "", "/");
});

const SPACE = { id: "s1", currency: { code: "UYU", exponent: 2 } } as const;
const CURRENT = "2026-10";
const TODAY = "2026-10-29";
const ID_A = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0002";

const ACCOUNT = (overrides: Partial<AccountWithBalance> = {}): AccountWithBalance => ({
  id: "a1",
  name: "Itaú",
  type: "bank",
  balance_minor: 0,
  archived_at: null,
  closing_day: null,
  due_day: null,
  ...overrides,
});

/** `count` expenses of October, newest first, five a day. */
function expenses(count: number): MovementListItem[] {
  return Array.from({ length: count }, (_, index) =>
    movementItem({
      id: `e${index}`,
      date: `2026-10-${String(28 - Math.floor(index / 5)).padStart(2, "0")}`,
      description: `Compra ${index + 1}`,
      amount_minor: -(index + 1) * 100,
    }),
  );
}

const CATEGORY = (overrides: Partial<CategoryRead> = {}): CategoryRead => ({
  id: "c1",
  name: "Comida",
  kind: "expense",
  icon: "fork-knife",
  parent_id: null,
  archived_at: null,
  ...overrides,
});

const THREE: MovementListItem[] = [
  movementItem({ id: "t1", date: "2026-10-29", description: "Café", amount_minor: -18000 }),
  incomeItem({ id: "t2", date: "2026-10-28", description: "Sueldo", amount_minor: 6800000 }),
  transferItem({ id: "t3", date: "2026-10-27", description: "Pago de Visa Itaú" }),
];

type Setup = {
  items?: MovementListItem[];
  accounts?: AccountWithBalance[];
  categories?: CategoryRead[];
  fault?: (call: ScriptedCall) => Fault | undefined;
  delay?: (call: ScriptedCall) => number;
  url?: string;
};

function setup({
  items = THREE,
  accounts = [ACCOUNT()],
  categories = [],
  fault,
  delay,
  url = "/movimientos",
}: Setup = {}) {
  replaceState(null, "", url);
  const state = { items, fault, delay };
  const api: ScriptedMovementsApi = scriptedMovementsApi({
    items: () => state.items,
    accounts: () => accounts,
    categories: () => categories,
    fault: (call) => state.fault?.(call),
    delay: (call) => state.delay?.(call) ?? 0,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      {/* The magnifier lives in the header of the page, outside the screen: it is next to it here. */}
      <SearchToggle currentMonth={CURRENT} />
      <MovementsScreen space={SPACE} currentMonth={CURRENT} today={TODAY} api={api} />
    </QueryClientProvider>,
  );
  return { api, client, state, view };
}

const kinds = (api: ScriptedMovementsApi) => api.calls.map((call) => call.kind);
const callsOf = (api: ScriptedMovementsApi, kind: ScriptedCall["kind"]) =>
  api.calls.filter((call) => call.kind === kind);

/** The filters' card (desktop) and the phone's controls: two copies of the type, the month and so on. */
const desktopFilters = () => within(screen.getByRole("region", { name: "Filtros" }));
const phoneControls = () =>
  within(document.querySelector("[data-slot='month-nav']")!.parentElement!.parentElement!);

async function loaded() {
  await screen.findByRole("table");
}

describe("the first load", () => {
  it("shows the skeleton, then the movements of the month in the table and the days", async () => {
    setup();
    expect(screen.getByRole("status", { name: "Cargando movimientos" })).toBeTruthy();
    await loaded();
    expect(screen.queryByRole("status", { name: "Cargando movimientos" })).toBeNull();
    const table = screen.getByRole("table", { name: "Movimientos de Octubre 2026" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByText("Café")).toBeTruthy();
    // The days of the phone: today and yesterday are named, the rest by their weekday.
    expect(screen.getByRole("heading", { name: "Hoy · jueves 29 de octubre" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ayer · miércoles 28 de octubre" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Martes 27 de octubre" })).toBeTruthy();
  });

  it("asks for the month of the space, 50 movements, the summary and the accounts with the archived ones", async () => {
    const { api } = setup();
    await loaded();
    expect(callsOf(api, "list")[0]!.query).toEqual({ month: CURRENT, limit: 50 });
    expect(callsOf(api, "summary")[0]!.query).toEqual({ month: CURRENT });
    expect(callsOf(api, "accounts")[0]!.query).toEqual({ include_archived: true });
    expect(callsOf(api, "categories")[0]!.query).toEqual({ include_archived: true });
    // It does not ask for the total of the space: the list has rows.
    expect(callsOf(api, "total")).toHaveLength(0);
  });

  it("writes the summary of the month: +income, −expense and what is left", async () => {
    setup();
    await loaded();
    const summary = await screen.findByRole("region", { name: "Resumen de Octubre 2026" });
    expect(summary.textContent).toContain("+$ 68.000,00");
    expect(summary.textContent).toContain("−$ 180,00");
    expect(summary.textContent).toContain("+$ 67.820,00");
  });

  it("announces how many movements the filters leave, for assistive technology", async () => {
    setup();
    await loaded();
    await waitFor(() =>
      expect(
        screen.getAllByRole("status").some((s) => s.textContent === "Octubre 2026: 3 movimientos"),
      ).toBe(true),
    );
  });

  it("shows the table and its footer to desktop and the days to a phone, one hidden by CSS each", async () => {
    setup();
    await loaded();
    const table = screen.getByRole("table");
    expect(table.closest("[data-slot='movements-table']")!.parentElement!.className).toContain(
      "max-lg:hidden",
    );
    expect(document.querySelector("[data-slot='movement-day-groups']")!.className).toContain(
      "lg:hidden",
    );
    expect(document.querySelector("[data-slot='more-sentinel']")!.className).toContain("lg:hidden");
    expect(screen.getByRole("region", { name: "Filtros" }).parentElement!.className).toContain(
      "max-lg:hidden",
    );
    expect(
      document.querySelector("[data-slot='month-nav']")!.parentElement!.parentElement!.className,
    ).toContain("lg:hidden");
  });

  it("writes 'Mostrando n de m movimientos' under the table", async () => {
    setup();
    await loaded();
    await screen.findByText("Mostrando 3 de 3 movimientos");
  });

  it("draws every row read only: no link and no button in the list or in the table", async () => {
    setup();
    await loaded();
    expect(
      document.querySelectorAll("tbody a, tbody button, [data-slot='movement-row'] a"),
    ).toHaveLength(0);
    expect(
      document.querySelectorAll(
        "[data-slot='movement-day-groups'] a, [data-slot='movement-day-groups'] button",
      ),
    ).toHaveLength(0);
  });
});

describe("the filters", () => {
  it("shows the month and the type that the URL says, before the list arrives", async () => {
    setup({ url: "/movimientos?mes=2026-09&tipo=ingresos" });
    expect((screen.getByRole("combobox", { name: "Mes" }) as HTMLSelectElement).value).toBe(
      "2026-09",
    );
    expect(
      desktopFilters().getByRole("button", { name: "Ingresos" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByText("Setiembre 2026", { selector: "span" })).toBeTruthy();
  });

  it("filters by type from the chips, in the URL and in the request", async () => {
    const { api } = setup();
    await loaded();
    fireEvent.click(desktopFilters().getByRole("button", { name: "Gastos" }));
    expect(window.location.search).toBe("?tipo=gastos");
    await waitFor(() => expect(callsOf(api, "list").at(-1)!.query.type).toBe("expense"));
    await waitFor(() => expect(callsOf(api, "summary").at(-1)!.query.type).toBe("expense"));
    await waitFor(() => expect(screen.queryByText("Sueldo")).toBeNull());
    expect(screen.getAllByText("Café").length).toBeGreaterThan(0);
  });

  it("changes the month from the desktop select and from the phone's arrows", async () => {
    const { api } = setup();
    await loaded();
    fireEvent.change(screen.getByRole("combobox", { name: "Mes" }), {
      target: { value: "2026-09" },
    });
    expect(window.location.search).toBe("?mes=2026-09");
    await waitFor(() => expect(callsOf(api, "list").at(-1)!.query.month).toBe("2026-09"));
    fireEvent.click(phoneControls().getByRole("button", { name: "Mes siguiente" }));
    expect(window.location.search).toBe("");
    await waitFor(() => expect(callsOf(api, "list").at(-1)!.query.month).toBe("2026-10"));
    fireEvent.click(phoneControls().getByRole("button", { name: "Mes anterior" }));
    expect(window.location.search).toBe("?mes=2026-09");
  });

  it("keeps the type chosen on the phone's chips and on desktop's in step, since both read the URL", async () => {
    setup();
    await loaded();
    fireEvent.click(phoneControls().getByRole("button", { name: "Ingresos" }));
    expect(
      desktopFilters().getByRole("button", { name: "Ingresos" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      phoneControls().getByRole("button", { name: "Todos" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("filters by the search of a link", async () => {
    const { api } = setup({ url: "/movimientos?q=CAFE" });
    await loaded();
    expect(callsOf(api, "list")[0]!.query).toEqual({ month: CURRENT, q: "CAFE", limit: 50 });
    // The backend compares without accents or case: "CAFE" finds "Café".
    expect(screen.getAllByText("Café").length).toBeGreaterThan(0);
    expect(screen.queryByText("Sueldo")).toBeNull();
    await screen.findByText("Mostrando 1 de 1 movimiento");
  });

  it("ignores a URL that says nonsense: the month of the space, no type, no filters", async () => {
    const { api } = setup({
      url: "/movimientos?mes=2026-13&tipo=otro&cuenta_id=no-es-uuid&q=%20%20",
    });
    await loaded();
    expect(callsOf(api, "list")[0]!.query).toEqual({ month: CURRENT, limit: 50 });
  });

  it("filters by an account of a link", async () => {
    const { api } = setup({
      url: `/movimientos?cuenta_id=${ID_A}`,
      items: [
        movementItem({ account: { ...ITAU, id: ID_A } }),
        movementItem({ account: EFECTIVO }),
      ],
    });
    await loaded();
    expect(callsOf(api, "list")[0]!.query.account_id).toBe(ID_A);
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
  });

  it("keeps the rows of the previous filters, dimmed and busy, while the new ones load", async () => {
    let slow = false;
    const { state } = setup({ delay: (call) => (slow && call.kind === "list" ? 50 : 0) });
    await loaded();
    slow = true;
    state.delay = (call) => (call.kind === "list" || call.kind === "summary" ? 50 : 0);
    fireEvent.click(desktopFilters().getByRole("button", { name: "Ingresos" }));
    await waitFor(() => expect(document.querySelector("[aria-busy='true']")).not.toBeNull());
    // The old rows are still there, not a skeleton.
    expect(screen.queryByRole("status", { name: "Cargando movimientos" })).toBeNull();
    expect(screen.getAllByText("Café").length).toBeGreaterThan(0);
    expect(document.querySelector("[aria-busy='true']")!.className).toContain("opacity-60");
    await waitFor(() => expect(document.querySelector("[aria-busy='true']")).toBeNull());
    expect(screen.queryByText("Café")).toBeNull();
    expect(screen.getAllByText("Sueldo").length).toBeGreaterThan(0);
  });

  it("hides the summary with Transferencias: there is nothing to add up", async () => {
    setup();
    await loaded();
    await screen.findByRole("region", { name: "Resumen de Octubre 2026" });
    fireEvent.click(desktopFilters().getByRole("button", { name: "Transferencias" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: /Resumen/ })).toBeNull());
    expect(screen.getAllByText("Pago de Visa Itaú").length).toBeGreaterThan(0);
  });
});

// Accounts and categories with real ids: the URL only takes a uuid for them.
const ID_VISA = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0003";
const ID_FOOD = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0010";
const ID_SUPER = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0011";
const ID_SALARY = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0012";
const ID_PETS = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0013";
const ID_UNKNOWN = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0099";

const A_ITAU = { ...ITAU, id: ID_A };
const A_VISA = { ...VISA, id: ID_VISA };
const FOOD = { id: ID_FOOD, name: "Comida", icon: "fork-knife" } as const;

const FILTER_ITEMS: MovementListItem[] = [
  movementItem({
    id: "f1",
    date: "2026-10-29",
    description: "Café",
    account: A_VISA,
    category: { ...FOOD, id: ID_SUPER, name: "Supermercado", parent: FOOD },
  }),
  movementItem({
    id: "f2",
    date: "2026-10-28",
    description: "Almuerzo",
    account: A_ITAU,
    category: { ...FOOD, parent: null },
  }),
  incomeItem({
    id: "f3",
    date: "2026-10-27",
    description: "Sueldo",
    account: A_ITAU,
    category: { id: ID_SALARY, name: "Sueldo", icon: "money", parent: null },
  }),
];
const FILTER_ACCOUNTS = [
  ACCOUNT({ id: ID_A, name: "Itaú" }),
  ACCOUNT({ id: ID_VISA, name: "Visa Itaú", type: "credit_card" }),
  ACCOUNT({
    id: "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0004",
    name: "BROU",
    archived_at: "2026-09-01T12:00:00Z",
  }),
];
const FILTER_CATEGORIES = [
  CATEGORY({ id: ID_FOOD, name: "Comida" }),
  CATEGORY({ id: ID_SUPER, name: "Supermercado", parent_id: ID_FOOD }),
  CATEGORY({ id: ID_SALARY, name: "Sueldo", kind: "income" }),
  CATEGORY({ id: ID_PETS, name: "Mascotas", archived_at: "2026-09-01T12:00:00Z" }),
];

const filterSetup = (extra: Setup = {}) =>
  setup({
    items: FILTER_ITEMS,
    accounts: FILTER_ACCOUNTS,
    categories: FILTER_CATEGORIES,
    ...extra,
  });

const searchFieldIn = (scope: ReturnType<typeof within>) =>
  scope.getByRole("searchbox", { name: "Buscar por descripción" }) as HTMLInputElement;
const accountSelect = (scope = desktopFilters()) =>
  scope.getByRole("combobox", { name: "Cuenta" }) as HTMLSelectElement;
const categorySelect = (scope = desktopFilters()) =>
  scope.getByRole("combobox", { name: "Categoría" }) as HTMLSelectElement;
const optionLabels = (select: HTMLSelectElement) =>
  Array.from(select.options).map((option) => option.textContent);
const chosenLabel = (select: HTMLSelectElement) => select.selectedOptions[0]?.textContent;
/** Whether the table has the row of a movement: by its description, never by a name that also is an option. */
const hasRow = (description: string) =>
  within(screen.getByRole("table")).queryByRole("rowheader", { name: description }) !== null;
const NO_RESULTS = "No hay movimientos con estos filtros";
/** Lets the real clock run, so a debounce that was not cancelled has the time to fire. */
const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

describe("the search", () => {
  it("searches from the desktop field once the typing stops, and writes it to the URL", async () => {
    const { api } = setup();
    await loaded();
    const field = searchFieldIn(desktopFilters());
    fireEvent.change(field, { target: { value: "cafe" } });
    // Not a request per key: the URL waits for the typing to stop.
    expect(window.location.search).toBe("");
    await waitFor(() => expect(window.location.search).toBe("?q=cafe"));
    await waitFor(() => expect(callsOf(api, "list").at(-1)!.query.q).toBe("cafe"));
    await waitFor(() => expect(hasRow("Sueldo")).toBe(false));
    expect(hasRow("Café")).toBe(true);
  });

  it("searches at once with Enter", async () => {
    setup();
    await loaded();
    const field = searchFieldIn(desktopFilters());
    fireEvent.change(field, { target: { value: "sueldo" } });
    fireEvent.submit(field.closest("form")!);
    expect(window.location.search).toBe("?q=sueldo");
  });

  it("says there is nothing for the search, with a way to clear it, and empties the field with it", async () => {
    setup();
    await loaded();
    const field = searchFieldIn(desktopFilters());
    fireEvent.change(field, { target: { value: "zzz" } });
    fireEvent.submit(field.closest("form")!);
    await screen.findByText("No hay movimientos con estos filtros");
    fireEvent.click(screen.getByRole("button", { name: "Quitar filtros" }));
    expect(window.location.search).toBe("");
    expect(searchFieldIn(desktopFilters()).value).toBe("");
    await loaded();
    expect(hasRow("Sueldo")).toBe(true);
  });

  it("keeps the phone's field shut until the magnifier opens it, while desktop's is always there", async () => {
    setup();
    await loaded();
    expect(phoneControls().queryByRole("searchbox")).toBeNull();
    expect(searchFieldIn(desktopFilters())).toBeTruthy();
    const magnifier = screen.getByRole("button", { name: "Buscar" });
    expect(magnifier.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens the phone's field with the magnifier, focused, and shuts it clearing the search", async () => {
    setup();
    await loaded();
    const magnifier = screen.getByRole("button", { name: "Buscar" });
    fireEvent.click(magnifier);
    const field = searchFieldIn(phoneControls());
    expect(document.activeElement).toBe(field);
    expect(magnifier.getAttribute("aria-expanded")).toBe("true");
    fireEvent.change(field, { target: { value: "cafe" } });
    fireEvent.submit(field.closest("form")!);
    expect(window.location.search).toBe("?q=cafe");
    // Enter on a phone puts the keyboard away.
    expect(document.activeElement).not.toBe(field);
    fireEvent.click(phoneControls().getByRole("button", { name: "Cerrar la búsqueda" }));
    expect(phoneControls().queryByRole("searchbox")).toBeNull();
    expect(window.location.search).toBe("");
    expect(document.activeElement?.id).toBe(SEARCH_TOGGLE_ID);
    expect(searchFieldIn(desktopFilters()).value).toBe("");
  });

  it("opens the phone's field with the text of a link's search, and desktop's has it too", async () => {
    const { api } = setup({ url: "/movimientos?q=cafe" });
    await loaded();
    expect(searchFieldIn(phoneControls()).value).toBe("cafe");
    expect(searchFieldIn(desktopFilters()).value).toBe("cafe");
    expect(callsOf(api, "list")[0]!.query.q).toBe("cafe");
  });

  it("keeps both the month and the search when the month changes before the search is written", async () => {
    setup();
    await loaded();
    fireEvent.change(searchFieldIn(desktopFilters()), { target: { value: "cafe" } });
    // Inside the 350 ms of the pause: the month goes to the URL first, the search after it.
    fireEvent.change(screen.getByRole("combobox", { name: "Mes" }), {
      target: { value: "2026-09" },
    });
    expect(window.location.search).toBe("?mes=2026-09");
    await waitFor(() => expect(window.location.search).toBe("?mes=2026-09&q=cafe"));
    expect(searchFieldIn(desktopFilters()).value).toBe("cafe");
    expect((screen.getByRole("combobox", { name: "Mes" }) as HTMLSelectElement).value).toBe(
      "2026-09",
    );
  });

  it("keeps both the type and the search when the type changes before the search is written", async () => {
    setup();
    await loaded();
    fireEvent.change(searchFieldIn(desktopFilters()), { target: { value: "cafe" } });
    fireEvent.click(desktopFilters().getByRole("button", { name: "Gastos" }));
    expect(window.location.search).toBe("?tipo=gastos");
    await waitFor(() => expect(window.location.search).toBe("?tipo=gastos&q=cafe"));
    expect(searchFieldIn(desktopFilters()).value).toBe("cafe");
  });

  describe("'Quitar filtros' and a text that was typed and not searched yet", () => {
    // A type with nothing in it: the empty state offers "Quitar filtros" while the URL has no search.
    const onlyIncomeWithGastos = () =>
      setup({
        url: "/movimientos?tipo=gastos",
        items: [incomeItem({ id: "only", date: "2026-10-27" })],
      });

    it("empties the desktop field and does not let the search come back", async () => {
      onlyIncomeWithGastos();
      await screen.findByText(NO_RESULTS);
      fireEvent.change(searchFieldIn(desktopFilters()), { target: { value: "x" } });
      fireEvent.click(screen.getByRole("button", { name: "Quitar filtros" }));
      expect(window.location.search).toBe("");
      expect(searchFieldIn(desktopFilters()).value).toBe("");
      // The 350 ms of the text that was typed run out with nobody left to write it.
      await wait(SEARCH_DEBOUNCE_MS + 150);
      expect(window.location.search).toBe("");
      expect(searchFieldIn(desktopFilters()).value).toBe("");
    });

    it("empties the phone's field too", async () => {
      onlyIncomeWithGastos();
      await screen.findByText(NO_RESULTS);
      fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
      fireEvent.change(searchFieldIn(phoneControls()), { target: { value: "x" } });
      fireEvent.click(screen.getByRole("button", { name: "Quitar filtros" }));
      expect(searchFieldIn(phoneControls()).value).toBe("");
      await wait(SEARCH_DEBOUNCE_MS + 150);
      expect(window.location.search).toBe("");
      expect(searchFieldIn(phoneControls()).value).toBe("");
    });

    it("still writes a search typed after it, and keeps what the person types next", async () => {
      onlyIncomeWithGastos();
      await screen.findByText(NO_RESULTS);
      fireEvent.change(searchFieldIn(desktopFilters()), { target: { value: "x" } });
      fireEvent.click(screen.getByRole("button", { name: "Quitar filtros" }));
      fireEvent.change(searchFieldIn(desktopFilters()), { target: { value: "sueldo" } });
      await waitFor(() => expect(window.location.search).toBe("?q=sueldo"));
      // Two writes in a row do not undo each other: the field keeps what was typed after the echo.
      fireEvent.change(searchFieldIn(desktopFilters()), { target: { value: "sueldo de" } });
      await waitFor(() => expect(window.location.search).toBe("?q=sueldo+de"));
      expect(searchFieldIn(desktopFilters()).value).toBe("sueldo de");
    });
  });

  it("starts the phone's field shut again after leaving the screen", async () => {
    const { view } = setup();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(searchFieldIn(phoneControls())).toBeTruthy();
    view.unmount();
    setup();
    await loaded();
    expect(phoneControls().queryByRole("searchbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Buscar" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("cuts a link's search to 100 characters, in the field and in the request", async () => {
    const { api } = setup({ url: `/movimientos?q=${"a".repeat(150)}` });
    await screen.findByText(NO_RESULTS);
    expect(callsOf(api, "list")[0]!.query.q).toBe("a".repeat(100));
    expect(searchFieldIn(desktopFilters()).value).toBe("a".repeat(100));
  });
});

describe("the account and the category", () => {
  it("lists the active accounts first and the archived ones marked, in the card", async () => {
    filterSetup();
    await loaded();
    await waitFor(() =>
      expect(optionLabels(accountSelect())).toEqual([
        "Todas las cuentas",
        "Itaú",
        "Visa Itaú",
        "BROU (archivada)",
      ]),
    );
  });

  it("groups the categories in Gastos, Ingresos and Archivadas, the principal ones only", async () => {
    filterSetup();
    await loaded();
    await waitFor(() =>
      expect(optionLabels(categorySelect())).toEqual([
        "Todas las categorías",
        "Comida",
        "Sueldo",
        "Mascotas (archivada)",
      ]),
    );
    const groups = Array.from(categorySelect().querySelectorAll("optgroup")).map(
      (group) => group.label,
    );
    expect(groups).toEqual(["Gastos", "Ingresos", "Archivadas"]);
  });

  it("filters by an account chosen in the card: the URL, the request and the rows", async () => {
    const { api } = filterSetup();
    await loaded();
    await waitFor(() => expect(optionLabels(accountSelect())).toContain("Itaú"));
    fireEvent.change(accountSelect(), { target: { value: ID_A } });
    expect(window.location.search).toBe(`?cuenta_id=${ID_A}`);
    await waitFor(() => expect(callsOf(api, "list").at(-1)!.query.account_id).toBe(ID_A));
    await waitFor(() => expect(callsOf(api, "summary").at(-1)!.query.account_id).toBe(ID_A));
    await waitFor(() => expect(hasRow("Café")).toBe(false));
    expect(hasRow("Almuerzo")).toBe(true);
    expect(hasRow("Sueldo")).toBe(true);
    // "Todas las cuentas" takes it off.
    fireEvent.change(accountSelect(), { target: { value: "" } });
    expect(window.location.search).toBe("");
  });

  it("filters by a main category and takes its subcategories in", async () => {
    const { api } = filterSetup();
    await loaded();
    await waitFor(() => expect(optionLabels(categorySelect())).toContain("Comida"));
    fireEvent.change(categorySelect(), { target: { value: ID_FOOD } });
    expect(window.location.search).toBe(`?categoria_id=${ID_FOOD}`);
    await waitFor(() => expect(callsOf(api, "list").at(-1)!.query.category_id).toBe(ID_FOOD));
    await waitFor(() => expect(hasRow("Sueldo")).toBe(false));
    // Café is on "Supermercado", a subcategory of Comida.
    expect(hasRow("Café")).toBe(true);
    expect(hasRow("Almuerzo")).toBe(true);
  });

  it("shows what the URL says once the lists load, and asks nothing else of the backend", async () => {
    const { api } = filterSetup({
      url: `/movimientos?cuenta_id=${ID_VISA}&categoria_id=${ID_SUPER}`,
    });
    await loaded();
    await waitFor(() => expect(chosenLabel(accountSelect())).toBe("Visa Itaú"));
    expect(chosenLabel(categorySelect())).toBe("Comida › Supermercado");
    expect(callsOf(api, "list")[0]!.query).toMatchObject({
      account_id: ID_VISA,
      category_id: ID_SUPER,
    });
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
  });

  it("marks an archived account and category of the URL as such", async () => {
    filterSetup({ url: `/movimientos?categoria_id=${ID_PETS}` });
    await screen.findByText(NO_RESULTS);
    await waitFor(() => expect(chosenLabel(categorySelect())).toBe("Mascotas (archivada)"));
  });

  it("names an account or a category that the lists do not have 'Otra', and keeps filtering by it", async () => {
    const { api } = filterSetup({
      url: `/movimientos?cuenta_id=${ID_UNKNOWN}&categoria_id=${ID_UNKNOWN}`,
    });
    await screen.findByText(NO_RESULTS);
    expect(chosenLabel(accountSelect())).toBe("Otra cuenta");
    expect(chosenLabel(categorySelect())).toBe("Otra categoría");
    expect(callsOf(api, "list")[0]!.query).toMatchObject({
      account_id: ID_UNKNOWN,
      category_id: ID_UNKNOWN,
    });
    // The way out is there: "Todas las cuentas".
    fireEvent.change(accountSelect(), { target: { value: "" } });
    expect(window.location.search).toBe(`?categoria_id=${ID_UNKNOWN}`);
  });

  it("lists an account and a category of 80 characters whole, and an emoji or Arabic one", async () => {
    const long = "x".repeat(80);
    filterSetup({
      accounts: [
        ACCOUNT({ id: ID_A, name: long }),
        ACCOUNT({ id: ID_VISA, name: "Cuenta 🏦 العربية" }),
      ],
      categories: [CATEGORY({ id: ID_FOOD, name: long }), CATEGORY({ id: ID_SUPER, name: "🍕" })],
    });
    await loaded();
    await waitFor(() => expect(optionLabels(accountSelect())).toContain(long));
    expect(optionLabels(accountSelect())).toContain("Cuenta 🏦 العربية");
    expect(optionLabels(categorySelect())).toEqual(["Todas las categorías", long, "🍕"]);
  });

  it("leaves the select off, never an empty one, when its list failed", async () => {
    filterSetup({ fault: (call) => (call.kind === "categories" ? "server" : undefined) });
    await loaded();
    await waitFor(() => expect(categorySelect().disabled).toBe(true));
    expect(accountSelect().disabled).toBe(false);
    // It says why, in text, and the off select points to it (it cannot be tabbed to).
    const note = desktopFilters().getByText("No se pudieron cargar tus categorías.");
    expect(categorySelect().getAttribute("aria-describedby")).toBe(note.id);
    expect(accountSelect().hasAttribute("aria-describedby")).toBe(false);
    // The list of movements is right without it.
    expect(hasRow("Café")).toBe(true);
  });

  it("keeps the select of a chosen category on when its list failed, so it can be taken off", async () => {
    filterSetup({
      url: `/movimientos?categoria_id=${ID_SUPER}`,
      fault: (call) => (call.kind === "categories" ? "server" : undefined),
    });
    const note = await desktopFilters().findByText("No se pudieron cargar tus categorías.");
    expect(categorySelect().getAttribute("aria-describedby")).toBe(note.id);
    expect(categorySelect().disabled).toBe(false);
    expect(chosenLabel(categorySelect())).toBe("Otra categoría");
    fireEvent.change(categorySelect(), { target: { value: "" } });
    expect(window.location.search).toBe("");
  });
});

describe("the sheet 'Filtrar movimientos' of a phone", () => {
  // The screen loads the sheet on the first tap; the first import of a test run is the slow one.
  beforeAll(async () => {
    await import("./filter-sheet");
  });

  const filterButton = (name = "Filtrar") => phoneControls().getByRole("button", { name });
  const sheet = async () =>
    within(await screen.findByRole("dialog", { name: "Filtrar movimientos" }));
  const closed = () => waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  it("counts the account and the category on the button, and nothing else", async () => {
    filterSetup({ url: "/movimientos?mes=2026-09&tipo=gastos&q=cafe" });
    await screen.findByText("No hay movimientos con estos filtros");
    expect(filterButton("Filtrar")).toBeTruthy();
  });

  it("says how many filters are on, in words", async () => {
    filterSetup({ url: `/movimientos?cuenta_id=${ID_A}` });
    await loaded();
    expect(filterButton("Filtrar, 1 filtro activo")).toBeTruthy();
  });

  it("opens with what the URL says, and 'Ver movimientos' applies the account and the category in one go", async () => {
    filterSetup();
    await loaded();
    fireEvent.click(filterButton());
    const dialog = await sheet();
    await waitFor(() => expect(optionLabels(accountSelect(dialog))).toContain("Itaú"));
    expect(accountSelect(dialog).value).toBe("");
    fireEvent.change(accountSelect(dialog), { target: { value: ID_A } });
    fireEvent.change(categorySelect(dialog), { target: { value: ID_FOOD } });
    // Nothing is written until "Ver movimientos".
    expect(window.location.search).toBe("");
    fireEvent.click(dialog.getByRole("button", { name: "Ver movimientos" }));
    expect(window.location.search).toBe(`?cuenta_id=${ID_A}&categoria_id=${ID_FOOD}`);
    await closed();
    expect(filterButton("Filtrar, 2 filtros activos")).toBeTruthy();
    await waitFor(() => expect(hasRow("Café")).toBe(false));
    expect(hasRow("Almuerzo")).toBe(true);
  });

  it("throws the draft away when it is closed any other way, and opens again from the URL", async () => {
    filterSetup();
    await loaded();
    fireEvent.click(filterButton());
    let dialog = await sheet();
    await waitFor(() => expect(optionLabels(accountSelect(dialog))).toContain("Itaú"));
    fireEvent.change(accountSelect(dialog), { target: { value: ID_A } });
    fireEvent.keyDown(dialog.getByRole("button", { name: "Ver movimientos" }), { key: "Escape" });
    await closed();
    expect(window.location.search).toBe("");
    fireEvent.click(filterButton());
    dialog = await sheet();
    expect(accountSelect(dialog).value).toBe("");
  });

  it("'Quitar filtros' takes off the type, the search, the account and the category, but not the month", async () => {
    filterSetup({
      url: `/movimientos?mes=2026-09&tipo=gastos&q=cafe&cuenta_id=${ID_A}&categoria_id=${ID_FOOD}`,
    });
    await screen.findByText("No hay movimientos con estos filtros");
    fireEvent.click(filterButton("Filtrar, 2 filtros activos"));
    const dialog = await sheet();
    fireEvent.click(dialog.getByRole("button", { name: "Quitar filtros" }));
    expect(window.location.search).toBe("?mes=2026-09");
    await closed();
    expect(filterButton("Filtrar")).toBeTruthy();
  });

  it("'Quitar filtros' also empties a text typed and not searched yet, in the phone's field and in desktop's", async () => {
    filterSetup();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    fireEvent.click(filterButton());
    const dialog = await sheet();
    // The boxes are behind the sheet. Typing and tapping "Quitar filtros" inside the 350 ms is what a
    // quick finger does: here it happens in one tick, so the pause cannot hide the bug.
    const phoneField = () => document.getElementById(PHONE_SEARCH_INPUT_ID) as HTMLInputElement;
    const desktopField = () =>
      document.querySelector<HTMLInputElement>("[data-variant='desktop'] input")!;
    fireEvent.change(phoneField(), { target: { value: "x" } });
    fireEvent.change(desktopField(), { target: { value: "y" } });
    fireEvent.click(dialog.getByRole("button", { name: "Quitar filtros" }));
    await closed();
    await wait(SEARCH_DEBOUNCE_MS + 150);
    expect(window.location.search).toBe("");
    expect(phoneField().value).toBe("");
    expect(desktopField().value).toBe("");
  });

  it("says the categories did not load, and turns that select off", async () => {
    filterSetup({ fault: (call) => (call.kind === "categories" ? "server" : undefined) });
    await loaded();
    await waitFor(() => expect(categorySelect().disabled).toBe(true));
    fireEvent.click(filterButton());
    const dialog = await sheet();
    expect(dialog.getByText("No se pudieron cargar tus categorías.")).toBeTruthy();
    expect(categorySelect(dialog).disabled).toBe(true);
    expect(accountSelect(dialog).disabled).toBe(false);
  });
});

describe("the announcement of the filters", () => {
  it("says the month and the count once the list answers, from one place", async () => {
    setup({ url: "/movimientos?mes=2026-09" });
    await screen.findByText("No hay movimientos con estos filtros");
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("status")
          .some((s) => s.textContent === "Setiembre 2026: 0 movimientos"),
      ).toBe(true),
    );
  });

  it("does not announce the month's label by itself: that would say it twice", async () => {
    setup();
    await loaded();
    const live = Array.from(document.querySelectorAll("[aria-live]"));
    expect(live.filter((node) => node.textContent?.includes("Octubre 2026"))).toHaveLength(0);
    expect(document.querySelector("[data-slot='month-nav'] [aria-live]")).toBeNull();
  });
});

describe("when the list is empty", () => {
  it("is the invitation when the space has no movement at all, found out with the total of the space", async () => {
    const { api } = setup({ items: [] });
    await screen.findByText("Aún no tienes movimientos");
    expect(callsOf(api, "total")).toHaveLength(1);
    expect(callsOf(api, "total")[0]!.query).toEqual({});
    expect(screen.getByRole("link", { name: "Registrar movimiento" }).getAttribute("href")).toBe(
      "/?movimiento=nuevo",
    );
  });

  it("asks for the total only when the list is empty, and not before the list answered", async () => {
    const { api } = setup({ items: [], delay: (call) => (call.kind === "list" ? 30 : 0) });
    expect(callsOf(api, "total")).toHaveLength(0);
    await screen.findByText("Aún no tienes movimientos");
    expect(kinds(api).indexOf("total")).toBeGreaterThan(kinds(api).indexOf("list"));
  });

  it("hides desktop's filters, and keeps the phone's month and chips, for a space with none", async () => {
    setup({ items: [] });
    await screen.findByText("Aún no tienes movimientos");
    expect(screen.queryByRole("region", { name: "Filtros" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Mes" })).toBeNull();
    expect(screen.queryByRole("region", { name: /Resumen/ })).toBeNull();
    expect(phoneControls().getByRole("button", { name: "Mes anterior" })).toBeTruthy();
    expect(phoneControls().getByRole("button", { name: "Todos" })).toBeTruthy();
  });

  it("offers 'Nueva cuenta' instead when there is no active account to register on", async () => {
    setup({ items: [], accounts: [ACCOUNT({ archived_at: "2026-09-01T12:00:00Z" })] });
    await screen.findByText("Aún no tienes movimientos");
    expect(screen.queryByRole("link", { name: "Registrar movimiento" })).toBeNull();
    expect(screen.getByRole("link", { name: "Nueva cuenta" }).getAttribute("href")).toBe(
      "/cuentas/nueva",
    );
  });

  it("says 'No hay movimientos con estos filtros' when the month has none but the space does", async () => {
    setup({ items: THREE, url: "/movimientos?mes=2026-03" });
    await screen.findByText("No hay movimientos con estos filtros");
    expect(screen.queryByText("Aún no tienes movimientos")).toBeNull();
    // The filters stay, so the person can go to another month.
    expect(screen.getByRole("region", { name: "Filtros" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: /Resumen/ })).toBeNull();
  });

  it("offers 'Quitar filtros' only when something besides the month narrows the list", async () => {
    setup({ items: THREE, url: "/movimientos?mes=2026-03" });
    await screen.findByText("No hay movimientos con estos filtros");
    expect(screen.queryByRole("button", { name: "Quitar filtros" })).toBeNull();
    cleanup();
    setup({ items: THREE, url: "/movimientos?tipo=gastos&q=nada" });
    await screen.findByText("No hay movimientos con estos filtros");
    expect(screen.getByRole("button", { name: "Quitar filtros" })).toBeTruthy();
  });

  it("clears the type and the search but keeps the month, and sends the focus to the type", async () => {
    const { api } = setup({ url: "/movimientos?mes=2026-10&tipo=gastos&q=nada" });
    await screen.findByText("No hay movimientos con estos filtros");
    desktop = true;
    fireEvent.click(screen.getByRole("button", { name: "Quitar filtros" }));
    expect(window.location.search).toBe("");
    await loaded();
    expect(callsOf(api, "list").at(-1)!.query).toEqual({ month: CURRENT, limit: 50 });
    expect(document.activeElement).toBe(desktopFilters().getByRole("button", { name: "Todos" }));
  });

  it("keeps the month when it clears", async () => {
    setup({ url: "/movimientos?mes=2026-09&tipo=gastos" });
    await screen.findByText("No hay movimientos con estos filtros");
    fireEvent.click(screen.getByRole("button", { name: "Quitar filtros" }));
    expect(window.location.search).toBe("?mes=2026-09");
  });

  it("is 'no results', never a false invitation, when the total of the space cannot be asked", async () => {
    setup({
      items: [],
      fault: (call) => (call.kind === "total" ? "server" : undefined),
    });
    await screen.findByText("No hay movimientos con estos filtros");
    expect(screen.queryByText("Aún no tienes movimientos")).toBeNull();
  });

  it("waits with the skeleton while the total of the space is asked", async () => {
    setup({ items: [], fault: (call) => (call.kind === "total" ? "never" : undefined) });
    await waitFor(() => expect(screen.getAllByRole("status").length).toBeGreaterThan(0));
    await act(async () => {});
    expect(screen.getByRole("status", { name: "Cargando movimientos" })).toBeTruthy();
    expect(screen.queryByText("Aún no tienes movimientos")).toBeNull();
    expect(screen.queryByText("No hay movimientos con estos filtros")).toBeNull();
  });
});

describe("when something fails", () => {
  it("says it could not load the movements, with a way to try again, never 'no movements'", async () => {
    let broken = true;
    const { api } = setup({
      fault: (call) => (broken && call.kind === "list" ? "server" : undefined),
    });
    await screen.findByText("No se pudieron cargar tus movimientos");
    expect(screen.queryByText("Aún no tienes movimientos")).toBeNull();
    expect(callsOf(api, "total")).toHaveLength(0);
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await loaded();
    expect(screen.queryByText("No se pudieron cargar tus movimientos")).toBeNull();
  });

  it("says the same without connection", async () => {
    setup({ fault: (call) => (call.kind === "list" ? "offline" : undefined) });
    await screen.findByText("No se pudieron cargar tus movimientos");
  });

  describe("the summary", () => {
    const summaryNotice = () => document.querySelector<HTMLElement>("[data-slot='summary-error']");

    it("says it could not load it, in the place of the figures, and the list stays right without it", async () => {
      const { api } = setup({ fault: (call) => (call.kind === "summary" ? "server" : undefined) });
      await loaded();
      await screen.findByText("No se pudo cargar el resumen");
      expect(screen.queryByRole("region", { name: /Resumen/ })).toBeNull();
      expect(screen.getByRole("table")).toBeTruthy();
      // With no total it says how many it shows, not "de m".
      await screen.findByText("Mostrando 3 movimientos");
      expect(screen.queryByText("No se pudieron cargar tus movimientos")).toBeNull();
      expect(callsOf(api, "summary")).toHaveLength(1);
    });

    it("asks for the summary again with 'Reintentar', and the figures take the notice's place", async () => {
      let broken = true;
      const { api } = setup({
        fault: (call) => (broken && call.kind === "summary" ? "server" : undefined),
      });
      await screen.findByText("No se pudo cargar el resumen");
      // Still broken: it asks again, says so again, and the button is free once it has answered.
      fireEvent.click(within(summaryNotice()!).getByRole("button", { name: "Reintentar" }));
      await waitFor(() => expect(callsOf(api, "summary")).toHaveLength(2));
      await waitFor(() =>
        expect(
          within(summaryNotice()!)
            .getByRole("button", { name: "Reintentar" })
            .getAttribute("aria-busy"),
        ).toBeNull(),
      );
      expect(screen.getByText("No se pudo cargar el resumen")).toBeTruthy();
      broken = false;
      fireEvent.click(within(summaryNotice()!).getByRole("button", { name: "Reintentar" }));
      const summary = await screen.findByRole("region", { name: "Resumen de Octubre 2026" });
      expect(summary.textContent).toContain("+$\u00A068.000,00");
      expect(screen.queryByText("No se pudo cargar el resumen")).toBeNull();
      expect(callsOf(api, "summary")).toHaveLength(3);
      await screen.findByText("Mostrando 3 de 3 movimientos");
    });

    it("keeps the button busy while it asks again, so it is not asked twice", async () => {
      let broken = true;
      const { api, state } = setup({
        fault: (call) => (broken && call.kind === "summary" ? "server" : undefined),
      });
      await screen.findByText("No se pudo cargar el resumen");
      state.delay = (call) => (call.kind === "summary" ? 40 : 0);
      broken = false;
      const button = within(summaryNotice()!).getByRole("button", { name: "Reintentar" });
      fireEvent.click(button);
      await waitFor(() => expect(button.getAttribute("aria-busy")).toBe("true"));
      fireEvent.click(button);
      await screen.findByRole("region", { name: "Resumen de Octubre 2026" });
      expect(callsOf(api, "summary")).toHaveLength(2);
    });

    it("says nothing while the summary is still loading", async () => {
      setup({ fault: (call) => (call.kind === "summary" ? "never" : undefined) });
      await loaded();
      await act(async () => {});
      expect(summaryNotice()).toBeNull();
      expect(screen.queryByRole("region", { name: /Resumen/ })).toBeNull();
    });

    it("says nothing with Transferencias chosen: there is no figure to miss", async () => {
      setup({
        url: "/movimientos?tipo=transferencias",
        fault: (call) => (call.kind === "summary" ? "server" : undefined),
      });
      await loaded();
      await screen.findByText("Mostrando 1 movimiento");
      expect(summaryNotice()).toBeNull();
    });

    it("keeps the previous figures, dimmed, while the new ones load, and only then says it failed", async () => {
      let broken = false;
      const { state } = setup({
        fault: (call) => (broken && call.kind === "summary" ? "server" : undefined),
      });
      await screen.findByRole("region", { name: "Resumen de Octubre 2026" });
      broken = true;
      state.delay = (call) => (call.kind === "summary" ? 50 : 0);
      fireEvent.click(desktopFilters().getByRole("button", { name: "Gastos" }));
      await waitFor(() => expect(document.querySelector("[aria-busy='true']")).not.toBeNull());
      expect(summaryNotice()).toBeNull();
      expect(screen.getByRole("region", { name: "Resumen de Octubre 2026" })).toBeTruthy();
      await screen.findByText("No se pudo cargar el resumen");
      expect(screen.queryByRole("region", { name: /Resumen/ })).toBeNull();
    });

    it("keeps the figures it has when a refresh of the summary fails: they are still the month's", async () => {
      let broken = false;
      const { client } = setup({
        fault: (call) => (broken && call.kind === "summary" ? "server" : undefined),
      });
      await screen.findByRole("region", { name: "Resumen de Octubre 2026" });
      broken = true;
      await act(async () => {
        await client.invalidateQueries({ queryKey: ["spaces", "s1", "transactions", "summary"] });
      });
      expect(summaryNotice()).toBeNull();
      expect(screen.getByRole("region", { name: "Resumen de Octubre 2026" })).toBeTruthy();
    });
  });

  it("keeps showing the table while the accounts fail: the list is still right", async () => {
    setup({ fault: (call) => (call.kind === "accounts" ? "server" : undefined) });
    await loaded();
    await screen.findByRole("region", { name: "Resumen de Octubre 2026" });
    expect(document.querySelector("[data-slot='summary-error']")).toBeNull();
    expect(screen.queryByText("No se pudieron cargar tus movimientos")).toBeNull();
    await screen.findByText("Mostrando 3 de 3 movimientos");
  });

  it("keeps the rows it has when a refresh fails, and says so with a way to try again", async () => {
    let broken = false;
    const { client } = setup({
      fault: (call) => (broken && call.kind === "list" ? "server" : undefined),
    });
    await loaded();
    broken = true;
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["spaces", "s1", "transactions", "list"] });
    });
    await screen.findByText("No se pudo actualizar la lista");
    expect(screen.getAllByText("Café").length).toBeGreaterThan(0);
    expect(screen.queryByText("No se pudieron cargar tus movimientos")).toBeNull();
    // "Cargar más" and the sentinel wait: the rows are not known to be current.
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.queryByText("No se pudo actualizar la lista")).toBeNull());
  });
});

describe("more movements", () => {
  it("loads 50 at first and says how many there are in all", async () => {
    setup({ items: expenses(120) });
    await loaded();
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(51);
    await screen.findByText("Mostrando 50 de 120 movimientos");
  });

  it("loads the next page with 'Cargar más' and goes on until the last, where the button goes away", async () => {
    const { api } = setup({ items: expenses(120) });
    await loaded();
    await screen.findByText("Mostrando 50 de 120 movimientos");
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    await screen.findByText("Mostrando 100 de 120 movimientos");
    expect(callsOf(api, "next-page")[0]!.query).toEqual({
      month: CURRENT,
      limit: 50,
      cursor: "cursor:50",
    });
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    await screen.findByText("Mostrando 120 de 120 movimientos");
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(121);
  });

  it("has no 'Cargar más' when everything fits in the first page", async () => {
    setup({ items: expenses(50) });
    await loaded();
    await screen.findByText("Mostrando 50 de 50 movimientos");
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
  });

  it("asks for one page only when 'Cargar más' is pressed twice in a row", async () => {
    const { api } = setup({
      items: expenses(120),
      delay: (call) => (call.kind === "next-page" ? 30 : 0),
    });
    await loaded();
    await screen.findByText("Mostrando 50 de 120 movimientos");
    const button = screen.getByRole("button", { name: "Cargar más" });
    act(() => {
      button.click();
      button.click();
    });
    await screen.findByText("Mostrando 100 de 120 movimientos");
    expect(callsOf(api, "next-page")).toHaveLength(1);
  });

  it("groups a day that two pages share into one", async () => {
    // Five a day, so day 28 has movements 0 to 4 and day 18 has 50 to 54: no day is cut by 50. With
    // 48 a day-split is forced.
    const items = expenses(120).map((item, index) => ({
      ...item,
      date: index < 53 ? "2026-10-28" : "2026-10-27",
    }));
    setup({ items });
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    await screen.findByText("Mostrando 100 de 120 movimientos");
    expect(screen.getAllByRole("heading", { name: /^Ayer/ })).toHaveLength(1);
    const section = screen.getByRole("region", { name: /^Ayer/ });
    expect(within(section).getAllByRole("listitem")).toHaveLength(53);
  });

  describe("on a phone, near the end", () => {
    it("loads the next page by itself when the sentinel comes near", async () => {
      const { api } = setup({ items: expenses(120) });
      await loaded();
      expect(FakeObserver.live).toHaveLength(1);
      act(() => FakeObserver.live[0]!.report(true));
      await screen.findByText("Mostrando 100 de 120 movimientos");
      expect(callsOf(api, "next-page")).toHaveLength(1);
    });

    it("says 'Cargando más movimientos' while it loads, and watches again when it is done", async () => {
      setup({ items: expenses(120), delay: (call) => (call.kind === "next-page" ? 30 : 0) });
      await loaded();
      act(() => FakeObserver.live[0]!.report(true));
      await screen.findByText("Cargando más movimientos");
      expect(FakeObserver.live).toHaveLength(0);
      await screen.findByText("Mostrando 100 de 120 movimientos");
      await waitFor(() => expect(FakeObserver.live).toHaveLength(1));
    });

    it("does not watch on the last page", async () => {
      setup({ items: expenses(50) });
      await loaded();
      expect(FakeObserver.live).toHaveLength(0);
    });

    it("never loads by itself from 1024 px: 'Cargar más' is there instead", async () => {
      const { api } = setup({ items: expenses(120) });
      await loaded();
      desktop = true;
      act(() => FakeObserver.live[0]!.report(true));
      await act(async () => {});
      expect(callsOf(api, "next-page")).toHaveLength(0);
    });

    it("waits while the rows are the previous filters': their cursor is of another list", async () => {
      const { state, api } = setup({ items: expenses(120) });
      await loaded();
      await screen.findByRole("button", { name: "Cargar más" });
      state.delay = (call) => (call.kind === "list" ? 60 : 0);
      fireEvent.click(desktopFilters().getByRole("button", { name: "Gastos" }));
      await waitFor(() => expect(document.querySelector("[aria-busy='true']")).not.toBeNull());
      // The query of the new filters has no pages yet, so it has no next page to ask for: the
      // sentinel is not watching and "Cargar más" is not there. Nothing sends the old cursor
      // with the new filters.
      expect(FakeObserver.live).toHaveLength(0);
      expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
      await waitFor(() => expect(document.querySelector("[aria-busy='true']")).toBeNull());
      expect(FakeObserver.live).toHaveLength(1);
      expect(screen.getByRole("button", { name: "Cargar más" })).toBeTruthy();
      expect(callsOf(api, "next-page")).toHaveLength(0);
    });
  });

  describe("when the next page fails", () => {
    it("says so once, under the list, and asks for nothing more until 'Reintentar'", async () => {
      let broken = true;
      const { api } = setup({
        items: expenses(120),
        fault: (call) => (broken && call.kind === "next-page" ? "offline" : undefined),
      });
      await loaded();
      act(() => FakeObserver.live[0]!.report(true));
      await screen.findByText("No se pudieron cargar más movimientos");
      // The sentinel is off and the button too: no loop, however long the person scrolls.
      expect(FakeObserver.live).toHaveLength(0);
      expect(screen.getByRole("button", { name: "Cargar más" }).getAttribute("aria-disabled")).toBe(
        "true",
      );
      await act(async () => {});
      expect(callsOf(api, "next-page")).toHaveLength(1);
      // The rows that were there stay.
      expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(51);
      broken = false;
      fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
      await screen.findByText("Mostrando 100 de 120 movimientos");
      expect(screen.queryByText("No se pudieron cargar más movimientos")).toBeNull();
      expect(callsOf(api, "next-page")).toHaveLength(2);
    });

    it("starts the list again from the first page when the cursor is not readable (422 cursor_invalid)", async () => {
      let broken = true;
      const { api } = setup({
        items: expenses(120),
        fault: (call) => (broken && call.kind === "next-page" ? "cursor" : undefined),
      });
      await loaded();
      fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
      await screen.findByText("No se pudieron cargar más movimientos");
      expect(screen.getByRole("alert").textContent).toContain("desde el principio");
      broken = false;
      const listCalls = callsOf(api, "list").length;
      fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
      await waitFor(() => expect(callsOf(api, "list").length).toBe(listCalls + 1));
      await screen.findByText("Mostrando 50 de 120 movimientos");
      expect(screen.queryByText("No se pudieron cargar más movimientos")).toBeNull();
    });

    it("asks for the same page again, without starting over, on any other 422", async () => {
      let broken = true;
      const { api } = setup({
        items: expenses(120),
        fault: (call) => (broken && call.kind === "next-page" ? "invalid" : undefined),
      });
      await loaded();
      fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
      await screen.findByText("No se pudieron cargar más movimientos");
      // It is not the unreadable cursor, so it does not say the list changed.
      expect(screen.getByRole("alert").textContent).not.toContain("desde el principio");
      broken = false;
      const listCalls = callsOf(api, "list").length;
      fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
      await screen.findByText("Mostrando 100 de 120 movimientos");
      expect(screen.queryByText("No se pudieron cargar más movimientos")).toBeNull();
      // The same page again: a second request for the next page, and the first page is not asked for.
      expect(callsOf(api, "next-page")).toHaveLength(2);
      expect(callsOf(api, "next-page")[1]!.query.cursor).toBe(
        callsOf(api, "next-page")[0]!.query.cursor,
      );
      expect(callsOf(api, "list")).toHaveLength(listCalls);
    });
  });
});

describe("a new movement", () => {
  it("shows up when the movements of the space are invalidated, as after registering one", async () => {
    const { client, state } = setup();
    await loaded();
    state.items = [
      movementItem({ id: "n1", date: "2026-10-29", description: "Recién registrado" }),
      ...THREE,
    ];
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["spaces", "s1", "transactions"] });
    });
    await waitFor(() => expect(screen.getAllByText("Recién registrado").length).toBeGreaterThan(0));
    await screen.findByText("Mostrando 4 de 4 movimientos");
    expect(screen.getAllByRole("heading", { name: /^Hoy/ })).toHaveLength(1);
  });

  it("turns the invitation into the list when the first movement is registered", async () => {
    const { client, state } = setup({ items: [] });
    await screen.findByText("Aún no tienes movimientos");
    state.items = THREE;
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["spaces", "s1", "transactions"] });
    });
    await loaded();
    expect(screen.queryByText("Aún no tienes movimientos")).toBeNull();
    expect(screen.getByRole("region", { name: "Filtros" })).toBeTruthy();
  });
});

describe("the worst data", () => {
  it("draws the largest amount whole and a huge sum without throwing", async () => {
    const huge = Number.MAX_SAFE_INTEGER;
    setup({
      items: [
        incomeItem({ id: "h1", date: "2026-10-29", amount_minor: huge }),
        incomeItem({ id: "h2", date: "2026-10-28", amount_minor: huge }),
      ],
    });
    await loaded();
    expect(screen.getAllByText("+$ 90.071.992.547.409,91").length).toBeGreaterThan(0);
    // The sum of the two is beyond what a number holds: the summary still opens.
    expect(await screen.findByRole("region", { name: "Resumen de Octubre 2026" })).toBeTruthy();
  });

  it("draws a description of 200 characters and an account of 80 without breaking the row", async () => {
    const description = "x".repeat(200);
    setup({
      items: [
        movementItem({
          id: "w1",
          date: "2026-10-29",
          description,
          account: { id: "a9", name: "A".repeat(80), type: "bank" },
        }),
      ],
    });
    await loaded();
    expect(screen.getAllByText(description).length).toBeGreaterThan(0);
    for (const node of screen.getAllByText(description)) {
      expect(node.getAttribute("title")).toBe(description);
    }
  });

  it("reaches the first and the last month the backend takes with the phone's arrows", async () => {
    setup({ items: [], url: "/movimientos?mes=1900-01" });
    await screen.findByText("Aún no tienes movimientos");
    expect(
      phoneControls().getByRole("button", { name: "Mes anterior" }).getAttribute("aria-disabled"),
    ).toBe("true");
    cleanup();
    setup({ items: THREE, url: "/movimientos?mes=2199-12" });
    await screen.findByText("No hay movimientos con estos filtros");
    expect(
      phoneControls().getByRole("button", { name: "Mes siguiente" }).getAttribute("aria-disabled"),
    ).toBe("true");
    expect((screen.getByRole("combobox", { name: "Mes" }) as HTMLSelectElement).value).toBe(
      "2199-12",
    );
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EFECTIVO,
  ITAU,
  VISA,
  adjustmentItem,
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
import { transactionsQueryKey, type MovementListItem } from "@/lib/core/data/transactions";
import { AccountsScreen } from "./accounts-screen";

// The screen runs for real (the URL, the queries, the detail, the table, the states) against the
// scripted backend of Movimientos, which filters by account and month, pages by cursor and adds up
// the summary like the real one (`balance_change_minor` too). jsdom applies no CSS, so the detail is
// in the page whatever the width: `useIsDesktop` says whether it may ask for its movements.
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), desktop: false }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }),
  usePathname: () => "/cuentas",
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/components/use-is-desktop", () => ({
  DESKTOP_MEDIA_QUERY: "(min-width: 64rem)",
  useIsDesktop: () => mocks.desktop,
}));

const replaceState = window.history.replaceState.bind(window.history);

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.push.mockReset();
  mocks.desktop = true;
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: mocks.desktop, media: query }));
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

const ACCOUNTS: AccountWithBalance[] = [
  {
    id: "a1",
    name: "Itaú",
    type: "bank",
    balance_minor: 8425000,
    archived_at: null,
    closing_day: null,
    due_day: null,
  },
  {
    id: "a3",
    name: "Efectivo",
    type: "cash",
    balance_minor: 550000,
    archived_at: null,
    closing_day: null,
    due_day: null,
  },
  {
    id: "a2",
    name: "Visa Itaú",
    type: "credit_card",
    balance_minor: -2412000,
    archived_at: null,
    closing_day: 5,
    due_day: 12,
  },
];

const TRANSPORTE = { id: "c3", name: "Transporte", icon: "bus", parent: null } as const;
const HOGAR = { id: "c4", name: "Hogar", icon: "house", parent: null } as const;
const COMIDA = { id: "c1", name: "Comida", icon: "fork-knife", parent: null } as const;

/** The movements of Itaú of the canvas (K-V2-Escritorio, "cuentas"), with the balance the backend sends. */
const ITAU_ITEMS: MovementListItem[] = [
  movementItem({
    id: "i1",
    date: "2026-10-19",
    description: "Uber",
    amount_minor: -38000,
    category: TRANSPORTE,
    account: ITAU,
    balance_after_minor: 8425000,
  }),
  transferItem({
    id: "i2",
    date: "2026-10-17",
    description: "Pago de Visa Itaú",
    amount_minor: 1850000,
    balance_after_minor: 8463000,
  }),
  movementItem({
    id: "i3",
    date: "2026-10-16",
    description: "UTE",
    amount_minor: -215000,
    category: HOGAR,
    account: ITAU,
    balance_after_minor: 10313000,
  }),
  movementItem({
    id: "i4",
    date: "2026-10-10",
    description: "Antel",
    amount_minor: -162000,
    category: HOGAR,
    account: ITAU,
    balance_after_minor: 10528000,
  }),
  incomeItem({
    id: "i5",
    date: "2026-10-01",
    description: "Sueldo",
    amount_minor: 6800000,
    account: ITAU,
    balance_after_minor: 10690000,
  }),
];

/** The movements of the Visa: a purchase, a payment received (the other half of the transfer) and more. */
const VISA_ITEMS: MovementListItem[] = [
  movementItem({
    id: "v1",
    date: "2026-10-20",
    description: "Tienda Inglesa",
    amount_minor: -234000,
    category: COMIDA,
    account: VISA,
    balance_after_minor: -2412000,
  }),
  transferItem({
    id: "v2",
    date: "2026-10-17",
    description: "Pago recibido",
    amount_minor: 1850000,
    balance_after_minor: -2178000,
  }),
  movementItem({
    id: "v3",
    date: "2026-10-14",
    description: "Netflix",
    amount_minor: -39000,
    account: VISA,
    balance_after_minor: -4028000,
  }),
  movementItem({
    id: "v4",
    date: "2026-10-09",
    description: "Restaurante",
    amount_minor: -185000,
    account: VISA,
    balance_after_minor: -3989000,
  }),
];

const SEPTEMBER = movementItem({
  id: "s1",
  date: "2026-09-12",
  description: "Compra de setiembre",
  amount_minor: -50000,
  account: ITAU,
  balance_after_minor: 9000000,
});

type SetupOptions = {
  items?: MovementListItem[];
  accounts?: AccountWithBalance[];
  fault?: (call: ScriptedCall) => Fault | undefined;
  delay?: (call: ScriptedCall) => number;
  /** Changes what the scripted backend answers (a wrapper over its `GET`). */
  wrap?: (api: ScriptedMovementsApi) => ScriptedMovementsApi;
};

function setup(options: SetupOptions = {}) {
  const state = { items: options.items ?? [...ITAU_ITEMS, SEPTEMBER] };
  const scripted = scriptedMovementsApi({
    items: () => state.items,
    accounts: () => options.accounts ?? ACCOUNTS,
    fault: options.fault,
    delay: options.delay,
  });
  const api = options.wrap ? options.wrap(scripted) : scripted;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AccountsScreen space={SPACE} currentMonth={CURRENT} today={TODAY} api={api} />
    </QueryClientProvider>,
  );
  return { state, api: scripted, queryClient, ...view };
}

/** The screen with the table of the chosen account on it. */
async function setupLoaded(options: SetupOptions = {}) {
  const view = setup(options);
  await screen.findByRole("table");
  return view;
}

const detail = (name = "Itaú") => within(screen.getByRole("region", { name }));
const callsOf = (api: ScriptedMovementsApi, ...kinds: ScriptedCall["kind"][]) =>
  api.calls.filter((call) => kinds.includes(call.kind));
const text = (element: Element) => element.textContent ?? "";

/** The rows of the table as [date, description, category, amount, balance] texts. */
function tableRows(): string[][] {
  return within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .map((row) => Array.from(row.children).map(text));
}

describe("what the detail asks for", () => {
  it("asks for nothing but the accounts below 1024 px: the detail is hidden there", async () => {
    mocks.desktop = false;
    const { api } = setup();
    await screen.findByRole("heading", { name: "Disponible" });
    expect(api.calls.map((call) => call.kind)).toEqual(["accounts"]);
    // The detail is in the page (CSS hides it) but it is only the header: a skeleton, no request.
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("asks from 1024 px for the list of the account in the month, 50 at a time, with no type", async () => {
    const { api } = await setupLoaded();
    const [first] = callsOf(api, "list");
    expect(first!.query).toEqual({ month: "2026-10", account_id: "a1", limit: 50 });
    expect(callsOf(api, "list")).toHaveLength(1);
  });

  it("asks for the summary of the account and the month once: the figure and the count share it", async () => {
    const { api } = await setupLoaded();
    await screen.findByText("Mostrando 5 de 5 movimientos");
    const summaries = callsOf(api, "summary");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.query).toEqual({ month: "2026-10", account_id: "a1" });
  });

  it("uses the month and the day of the space, handed down by the server page", async () => {
    window.history.replaceState(null, "", "/cuentas?mes=2026-09");
    const { api } = await setupLoaded();
    expect(callsOf(api, "list")[0]!.query.month).toBe("2026-09");
    expect(await screen.findByText("Compra de setiembre")).toBeTruthy();
  });
});

describe("the figure of the month", () => {
  it("is the net movement of a bank account: the change of the balance, with a sign, transfers included", async () => {
    await setupLoaded();
    // 68.000 - 380 - 18.500 (the payment of the Visa) - 2.150 - 1.620 = 45.350, as in the canvas.
    const figure = (await detail().findByText("Movimiento neto de octubre")).parentElement!;
    await waitFor(() => expect(text(figure)).toContain("+$\u00A045.350,00"));
    expect(figure.querySelector("[role='status']")).toBeNull();
  });

  it("is the consumos of a card: what was spent, with no sign", async () => {
    window.history.replaceState(null, "", "/cuentas?sel=a2");
    await setupLoaded({ items: VISA_ITEMS });
    const figure = (await detail("Visa Itaú").findByText("Consumos de octubre")).parentElement!;
    // 2.340 + 390 + 1.850, as in the canvas; the payment received is not a consumo.
    await waitFor(() => expect(text(figure)).toContain("$\u00A04.580,00"));
    expect(text(figure)).not.toContain("+");
  });

  it("does not follow the type of the table: the backend's balance change ignores it", async () => {
    const { api } = await setupLoaded();
    fireEvent.click(detail().getByRole("button", { name: "Filtrar" }));
    fireEvent.click(detail().getByRole("button", { name: "Gastos" }));
    await waitFor(() => expect(window.location.search).toBe("?tipo=gastos"));
    await screen.findByText("Mostrando 3 de 3 movimientos");
    const figure = detail().getByText("Movimiento neto de octubre").parentElement!;
    await waitFor(() => expect(text(figure)).toContain("+$\u00A045.350,00"));
    // The figure keeps asking for the month without type; the count asks with it.
    const summaries = callsOf(api, "summary").map((call) => call.query);
    expect(summaries).toContainEqual({ month: "2026-10", account_id: "a1" });
    expect(summaries).toContainEqual({ month: "2026-10", account_id: "a1", type: "expense" });
  });

  it("names the month it is about, with the year when it is not this year's", async () => {
    window.history.replaceState(null, "", "/cuentas?mes=2025-03");
    setup({ items: [] });
    expect(await screen.findByText("Movimiento neto de marzo de 2025")).toBeTruthy();
  });

  it("is a zero when the month has nothing, not a missing figure", async () => {
    window.history.replaceState(null, "", "/cuentas?mes=2026-08");
    setup();
    const figure = (await screen.findByText("Movimiento neto de agosto")).parentElement!;
    await waitFor(() => expect(text(figure)).toContain("$\u00A00,00"));
  });

  it("shows a skeleton while it loads, with the label already on screen", async () => {
    setup({ delay: (call) => (call.kind === "summary" ? 50 : 0) });
    const label = await screen.findByText("Movimiento neto de octubre");
    expect(screen.getByRole("status", { name: "Cargando la cifra del mes" })).toBeTruthy();
    expect(label.parentElement!.textContent).not.toContain("$");
    await waitFor(() =>
      expect(screen.queryByRole("status", { name: "Cargando la cifra del mes" })).toBeNull(),
    );
  });

  it("says it could not load, with Reintentar, and recovers: never a zero", async () => {
    let failing = true;
    await setupLoaded({
      fault: (call) => (failing && call.kind === "summary" ? "server" : undefined),
    });
    const retry = await screen.findByRole("button", { name: "Reintentar: cifra del mes" });
    const figure = retry.closest("[data-slot='account-month-figure']")!;
    expect(text(figure)).toContain("No disponible");
    expect(text(figure)).not.toContain("$");
    failing = false;
    fireEvent.click(retry);
    await waitFor(() => expect(text(figure)).toContain("+$\u00A045.350,00"));
  });

  it("treats a summary of a bank with no balance change as a failure, never as 0", async () => {
    await setupLoaded({
      wrap: (scripted) =>
        ({
          ...scripted,
          GET: async (path: string, init?: unknown) => {
            const answer = await (scripted.GET as (p: string, i?: unknown) => Promise<unknown>)(
              path,
              init,
            );
            const data = (answer as { data?: Record<string, unknown> }).data;
            if (path.endsWith("/summary") && data) delete data.balance_change_minor;
            return answer;
          },
        }) as unknown as ScriptedMovementsApi,
    });
    expect(await screen.findByRole("button", { name: "Reintentar: cifra del mes" })).toBeTruthy();
    expect(text(detail().getByText("Movimiento neto de octubre").parentElement!)).not.toContain(
      "$\u00A00,00",
    );
  });
});

describe("the table", () => {
  it("has the columns of the canvas and a name for assistive technology", async () => {
    await setupLoaded();
    const table = screen.getByRole("table", { name: "Movimientos de Itaú en Octubre 2026" });
    const heads = within(table)
      .getAllByRole("columnheader")
      .map((head) => head.textContent);
    expect(heads).toEqual(["Fecha", "Descripción", "Categoría", "Monto", "Saldo"]);
    expect(
      within(table).getByRole("columnheader", { name: "Fecha" }).getAttribute("aria-sort"),
    ).toBe("descending");
  });

  it("tells each movement from the account's point of view, with the balance the backend sent", async () => {
    await setupLoaded();
    expect(tableRows()).toEqual([
      ["19 oct.", "Uber", "Transporte", "\u2212$\u00A0380,00", "$\u00A084.250,00"],
      [
        "17 oct.",
        "Pago de Visa Itaú",
        "Transferencia",
        "\u2212$\u00A018.500,00",
        "$\u00A084.630,00",
      ],
      ["16 oct.", "UTE", "Hogar", "\u2212$\u00A02.150,00", "$\u00A0103.130,00"],
      ["10 oct.", "Antel", "Hogar", "\u2212$\u00A01.620,00", "$\u00A0105.280,00"],
      ["1 oct.", "Sueldo", "Sueldo", "+$\u00A068.000,00", "$\u00A0106.900,00"],
    ]);
  });

  it("shows a card as debt: purchases with no sign, a payment received with a minus, Deuda in the head", async () => {
    window.history.replaceState(null, "", "/cuentas?sel=a2");
    await setupLoaded({ items: VISA_ITEMS });
    const heads = within(screen.getByRole("table"))
      .getAllByRole("columnheader")
      .map((head) => head.textContent);
    expect(heads.at(-1)).toBe("Deuda");
    expect(tableRows().map((row) => row.slice(1))).toEqual([
      ["Tienda Inglesa", "Comida", "$\u00A02.340,00", "$\u00A024.120,00"],
      ["Pago recibido", "Transferencia", "\u2212$\u00A018.500,00", "$\u00A021.780,00"],
      ["Netflix", "Comida › Supermercado", "$\u00A0390,00", "$\u00A040.280,00"],
      ["Restaurante", "Comida › Supermercado", "$\u00A01.850,00", "$\u00A039.890,00"],
    ]);
  });

  it("shows a transfer into the account with a plus, and the tones of the canvas", async () => {
    window.history.replaceState(null, "", "/cuentas?sel=a3");
    await setupLoaded({
      items: [
        movementItem({
          id: "e2",
          date: "2026-10-18",
          description: "Farmacia",
          amount_minor: -64000,
          account: EFECTIVO,
          balance_after_minor: 550000,
        }),
        transferItem({
          id: "e1",
          date: "2026-10-12",
          description: "Desde BROU",
          amount_minor: 300000,
          from_account: ITAU,
          to_account: EFECTIVO,
          balance_after_minor: 700000,
        }),
      ],
    });
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    const amountOf = (row: HTMLElement) => row.children[3] as HTMLElement;
    expect(text(amountOf(rows[0]!))).toBe("\u2212$\u00A0640,00");
    expect(amountOf(rows[0]!).className).toContain("text-foreground");
    expect(text(amountOf(rows[1]!))).toBe("+$\u00A03.000,00");
    // A transfer is quiet: the color of the muted text, as the transfer color of the canvas.
    expect(amountOf(rows[1]!).className).toContain("text-muted-foreground");
  });

  it("paints an income in the income color and writes an adjustment, quiet, with its own sign", async () => {
    await setupLoaded({
      items: [
        incomeItem({ id: "n1", date: "2026-10-03", account: ITAU, balance_after_minor: 7000000 }),
        adjustmentItem({
          id: "n2",
          date: "2026-10-02",
          description: "Ajuste de saldo",
          amount_minor: 8500000,
          account: ITAU,
          balance_after_minor: 200000,
        }),
      ],
    });
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect((rows[0]!.children[3] as HTMLElement).className).toContain("text-income");
    expect(text(rows[1]!.children[2]!)).toBe("Ajuste");
    expect(text(rows[1]!.children[3]!)).toBe("+$\u00A085.000,00");
    expect((rows[1]!.children[3] as HTMLElement).className).toContain("text-muted-foreground");
  });

  it("shows a dash, and says it in words, where a pending movement has no balance", async () => {
    await setupLoaded({
      items: [
        movementItem({
          id: "p1",
          status: "pending",
          date: "2026-10-25",
          description: "Gimnasio",
          amount_minor: -90000,
          account: ITAU,
          balance_after_minor: null,
        }),
        ...ITAU_ITEMS.slice(0, 1),
      ],
    });
    const row = within(screen.getByRole("table")).getAllByRole("row")[1]!;
    const balance = row.lastElementChild as HTMLElement;
    expect(text(balance)).toContain("—");
    expect(text(balance)).toContain("No cuenta para el saldo");
    expect(text(row)).toContain("Pendiente");
  });

  it("opens a movement from its description, over this screen, keeping the account and the month", async () => {
    window.history.replaceState(null, "", "/cuentas?sel=a1&mes=2026-10");
    await setupLoaded();
    const link = screen.getByRole("link", { name: "Uber" });
    expect(link.getAttribute("href")).toBe("/movimientos?movimiento=editar&id=i1");
    expect(link.getAttribute("aria-haspopup")).toBe("dialog");
    expect(fireEvent.click(link)).toBe(false);
    expect(window.location.search).toBe("?sel=a1&mes=2026-10&movimiento=editar&id=i1");
  });

  it("holds a very long description and the biggest amounts", async () => {
    const long = "Compra con un nombre larguísimo ".repeat(6).trim();
    const noSpaces = "x".repeat(200);
    await setupLoaded({
      items: [
        movementItem({
          id: "x1",
          date: "2026-10-05",
          description: long,
          amount_minor: -Number.MAX_SAFE_INTEGER,
          account: ITAU,
          balance_after_minor: -Number.MAX_SAFE_INTEGER,
        }),
        movementItem({
          id: "x2",
          date: "2026-10-04",
          description: noSpaces,
          amount_minor: -1,
          account: ITAU,
          balance_after_minor: 0,
        }),
      ],
    });
    const title = screen.getByText(long);
    expect(title.className).toContain("line-clamp-2");
    expect(title.className).toContain("wrap-anywhere");
    expect(title.getAttribute("title")).toBe(long);
    expect(screen.getByText(noSpaces).getAttribute("title")).toBe(noSpaces);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    // Nothing is cut: both figures keep all their digits and never wrap.
    expect(text(rows[0]!.children[3]!)).toBe("\u2212$\u00A090.071.992.547.409,91");
    expect(text(rows[0]!.children[4]!)).toBe("\u2212$\u00A090.071.992.547.409,91");
    expect((rows[0]!.children[3] as HTMLElement).className).toContain("whitespace-nowrap");
    expect((rows[0]!.children[4] as HTMLElement).className).toContain("whitespace-nowrap");
    // The table scrolls inside its card instead of pushing the card out.
    expect(
      screen.getByRole("table").closest("[data-slot='account-movements-table']")!.className,
    ).toContain("overflow-x-auto");
  });

  it("is a table of 560 px at least that scrolls sideways when the card is narrower", async () => {
    await setupLoaded();
    expect(screen.getByRole("table").className).toContain("min-w-140");
  });
});

describe("month and type", () => {
  it("changes the month with a native select named Mes and writes ?mes", async () => {
    const { api } = await setupLoaded();
    const select = detail().getByRole("combobox", { name: "Mes" }) as HTMLSelectElement;
    expect(select.value).toBe("2026-10");
    expect(select.selectedOptions[0]!.textContent).toBe("Octubre 2026");
    fireEvent.change(select, { target: { value: "2026-09" } });
    expect(window.location.search).toBe("?mes=2026-09");
    expect(await screen.findByText("Compra de setiembre")).toBeTruthy();
    expect(screen.queryByText("Uber")).toBeNull();
    expect(callsOf(api, "list").at(-1)!.query).toEqual({
      month: "2026-09",
      account_id: "a1",
      limit: 50,
    });
    expect(await detail().findByText("Movimiento neto de setiembre")).toBeTruthy();
  });

  it("keeps the rows of the month before, dimmed and busy, while the new month comes", async () => {
    await setupLoaded({ delay: (call) => (call.kind === "list" ? 80 : 0) });
    fireEvent.change(detail().getByRole("combobox", { name: "Mes" }), {
      target: { value: "2026-09" },
    });
    const busy = await waitFor(() => {
      const node = screen.getByRole("table").closest("[aria-busy='true']");
      expect(node).not.toBeNull();
      return node!;
    });
    expect(busy.className).toContain("opacity-60");
    expect(screen.getByText("Uber")).toBeTruthy();
    // Their cursor is of another list: "Cargar más" is off until the new month arrives.
    await screen.findByText("Compra de setiembre");
    expect(screen.getByRole("table").closest("[aria-busy='true']")).toBeNull();
  });

  it("opens 'Filtrar' with the four types, as a disclosure", async () => {
    await setupLoaded();
    const toggle = detail().getByRole("button", { name: "Filtrar" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(detail().queryByRole("button", { name: "Gastos" })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-controls")).toBe(
      detail().getByRole("group", { name: "Tipo de movimiento" }).parentElement!.id,
    );
    const types = within(detail().getByRole("group", { name: "Tipo de movimiento" }));
    // "Transferencias" says "Transf." to the eye on a phone, but its name is always the whole word.
    for (const name of ["Todos", "Gastos", "Ingresos", "Transferencias"]) {
      expect(types.getByRole("button", { name })).toBeTruthy();
    }
    expect(types.getAllByRole("button")).toHaveLength(4);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("filters by type through ?tipo, keeping the balance the backend sends", async () => {
    const { api } = await setupLoaded();
    fireEvent.click(detail().getByRole("button", { name: "Filtrar" }));
    fireEvent.click(detail().getByRole("button", { name: "Transferencias" }));
    expect(window.location.search).toBe("?tipo=transferencias");
    await waitFor(() => expect(tableRows()).toHaveLength(1));
    expect(tableRows()[0]).toEqual([
      "17 oct.",
      "Pago de Visa Itaú",
      "Transferencia",
      "\u2212$\u00A018.500,00",
      "$\u00A084.630,00",
    ]);
    expect(callsOf(api, "list").at(-1)!.query).toEqual({
      month: "2026-10",
      account_id: "a1",
      type: "transfer",
      limit: 50,
    });
    // The button says there is a filter on, in words and with the number.
    const toggle = detail().getByRole("button", { name: "Filtrar, 1 filtro activo" });
    expect(toggle.textContent).toBe("Filtrar1");
  });

  it("opens by itself when the address already has a ?tipo", async () => {
    window.history.replaceState(null, "", "/cuentas?tipo=gastos");
    await setupLoaded();
    const toggle = detail().getByRole("button", { name: "Filtrar, 1 filtro activo" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(detail().getByRole("button", { name: "Gastos" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("keeps the month and the type when another account is chosen", async () => {
    window.history.replaceState(null, "", "/cuentas?mes=2026-09&tipo=gastos");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { api } = await setupLoaded();
    fireEvent.click(screen.getByRole("link", { name: /^Efectivo/ }));
    expect(window.location.search).toBe("?mes=2026-09&tipo=gastos&sel=a3");
    await screen.findByRole("region", { name: "Efectivo" });
    await waitFor(() =>
      expect(callsOf(api, "list").at(-1)!.query).toEqual({
        month: "2026-09",
        account_id: "a3",
        type: "expense",
        limit: 50,
      }),
    );
  });

  it("does not show the rows of the previous account under the new one: it starts from a skeleton", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    await setupLoaded({
      items: [...ITAU_ITEMS, ...VISA_ITEMS.slice(0, 1)],
      delay: (call) => (call.kind === "list" ? 60 : 0),
    });
    fireEvent.click(screen.getByRole("link", { name: /^Visa Itaú/ }));
    await screen.findByRole("region", { name: "Visa Itaú" });
    expect(screen.queryByText("Uber")).toBeNull();
    expect(screen.getByRole("status", { name: "Cargando movimientos de la cuenta" })).toBeTruthy();
    expect(await screen.findByText("Tienda Inglesa")).toBeTruthy();
  });
});

describe("states", () => {
  it("shows a skeleton while the first page comes, and the header is already there", async () => {
    setup({ delay: (call) => (call.kind === "list" ? 60 : 0) });
    expect(await screen.findByRole("heading", { name: "Movimientos" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Cargando movimientos de la cuenta" })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(await screen.findByRole("table")).toBeTruthy();
  });

  it("says the account has no movements this month, and the figure is a zero", async () => {
    setup({ items: [] });
    expect(await screen.findByText("Esta cuenta no tiene movimientos este mes")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: "Quitar filtro" })).toBeNull();
    const figure = detail().getByText("Movimiento neto de octubre").parentElement!;
    await waitFor(() => expect(text(figure)).toContain("$\u00A00,00"));
  });

  it("names another month when the empty month is not the current one", async () => {
    window.history.replaceState(null, "", "/cuentas?mes=2026-08");
    setup();
    expect(await screen.findByText("Esta cuenta no tiene movimientos en agosto")).toBeTruthy();
  });

  it("talks about the type, with 'Quitar filtro', when a type is chosen and nothing matches", async () => {
    window.history.replaceState(null, "", "/cuentas?tipo=transferencias&mes=2026-09");
    setup();
    expect(await screen.findByText("No hay movimientos de este tipo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Quitar filtro" }));
    expect(window.location.search).toBe("?mes=2026-09");
    expect(await screen.findByText("Compra de setiembre")).toBeTruthy();
    // The focus stays in the filters: the button that had it is gone.
    expect(document.activeElement?.textContent).toBe("Todos");
  });

  it("sends the focus to 'Filtrar', not to the page, when 'Quitar filtro' is pressed with the row of the types closed (WCAG 2.4.3)", async () => {
    window.history.replaceState(null, "", "/cuentas?tipo=transferencias&mes=2026-09");
    setup();
    expect(await screen.findByText("No hay movimientos de este tipo")).toBeTruthy();
    // The row opened by itself because of the ?tipo; the person puts it away, with the type still on.
    const toggle = detail().getByRole("button", { name: "Filtrar, 1 filtro activo" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(detail().queryByRole("button", { name: "Todos" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Quitar filtro" }));
    expect(window.location.search).toBe("?mes=2026-09");
    // The chips are `hidden` and cannot take the focus: it goes to the control of that filter, which stays.
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(toggle);
    // Its name says the filter is off now, and the row stays as the person left it: closed.
    expect(toggle.getAttribute("aria-label")).toBe("Filtrar");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(detail().queryByRole("button", { name: "Todos" })).toBeNull();
    expect(await screen.findByText("Compra de setiembre")).toBeTruthy();
    expect(document.activeElement).toBe(toggle);
  });

  it("is an error with Reintentar when the list fails, never an empty month", async () => {
    let failing = true;
    setup({ fault: (call) => (failing && call.kind === "list" ? "server" : undefined) });
    expect(
      await screen.findByText("No se pudieron cargar los movimientos de esta cuenta"),
    ).toBeTruthy();
    expect(screen.queryByText("Esta cuenta no tiene movimientos este mes")).toBeNull();
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("table")).toBeTruthy();
    expect(screen.queryByText("No se pudieron cargar los movimientos de esta cuenta")).toBeNull();
  });

  it("is that error, and no empty month, for a space that is not the person's (404)", async () => {
    setup({
      wrap: (scripted) =>
        ({
          ...scripted,
          GET: async (path: string, init?: unknown) =>
            path.endsWith("/transactions") || path.endsWith("/summary")
              ? {
                  error: { code: "space_not_found", detail: "Space not found" },
                  response: new Response(null, { status: 404 }),
                }
              : (scripted.GET as (p: string, i?: unknown) => Promise<unknown>)(path, init),
        }) as unknown as ScriptedMovementsApi,
    });
    expect(
      await screen.findByText("No se pudieron cargar los movimientos de esta cuenta"),
    ).toBeTruthy();
    expect(screen.queryByText("Esta cuenta no tiene movimientos este mes")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("keeps the rows on screen, and says so, when a refresh fails", async () => {
    let failing = false;
    const { queryClient } = await setupLoaded({
      fault: (call) => (failing && call.kind === "list" ? "server" : undefined),
    });
    failing = true;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: transactionsQueryKey("s1") });
    });
    expect(await screen.findByText("No se pudo actualizar la lista")).toBeTruthy();
    expect(screen.getByText("Uber")).toBeTruthy();
  });

  it("announces the month and the count once, for a screen reader", async () => {
    await setupLoaded();
    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "Movimientos" })).getByRole("status").textContent,
      ).toBe("Octubre 2026: 5 movimientos"),
    );
  });
});

describe("Cargar más", () => {
  /** `count` expenses of Itaú in October, newest first, one a day. */
  function many(count: number): MovementListItem[] {
    return Array.from({ length: count }, (_, index) =>
      movementItem({
        id: `b${index}`,
        date: `2026-10-${String(28 - Math.floor(index / 5)).padStart(2, "0")}`,
        description: `Compra ${index + 1}`,
        amount_minor: -(index + 1) * 100,
        account: ITAU,
        balance_after_minor: 1000000 - index * 100,
      }),
    );
  }

  it("shows 'Mostrando n de m' and loads the next page with the cursor of the backend", async () => {
    const { api } = await setupLoaded({ items: many(120) });
    expect(await screen.findByText("Mostrando 50 de 120 movimientos")).toBeTruthy();
    expect(tableRows()).toHaveLength(50);
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(await screen.findByText("Mostrando 100 de 120 movimientos")).toBeTruthy();
    const next = callsOf(api, "next-page");
    expect(next).toHaveLength(1);
    expect(next[0]!.query.cursor).toBeTypeOf("string");
    expect(next[0]!.query.account_id).toBe("a1");
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(await screen.findByText("Mostrando 120 de 120 movimientos")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
  });

  it("is busy while the page loads and a second click does not ask twice", async () => {
    const { api } = await setupLoaded({
      items: many(80),
      delay: (call) => (call.kind === "next-page" ? 60 : 0),
    });
    const button = await screen.findByRole("button", { name: "Cargar más" });
    await act(async () => {
      button.click();
      button.click();
    });
    await screen.findByText("Mostrando 80 de 80 movimientos");
    expect(callsOf(api, "next-page")).toHaveLength(1);
  });

  it("says a next page failed once, asks nothing until Reintentar, and then loads it", async () => {
    let failing = true;
    const { api } = await setupLoaded({
      items: many(80),
      fault: (call) => (failing && call.kind === "next-page" ? "server" : undefined),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Cargar más" }));
    expect(await screen.findByText("No se pudieron cargar más movimientos")).toBeTruthy();
    expect(callsOf(api, "next-page")).toHaveLength(1);
    expect(tableRows()).toHaveLength(50);
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Mostrando 80 de 80 movimientos")).toBeTruthy();
  });

  it("starts the list again when the cursor can no longer be read (422 cursor_invalid)", async () => {
    let broken = true;
    const { api } = await setupLoaded({
      items: many(80),
      fault: (call) => (broken && call.kind === "next-page" ? "cursor" : undefined),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Cargar más" }));
    await screen.findByText("No se pudieron cargar más movimientos");
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(callsOf(api, "list").length).toBeGreaterThanOrEqual(2));
    expect(await screen.findByText("Mostrando 50 de 80 movimientos")).toBeTruthy();
  });

  it("does not show the footer text as 'de m' until the count is known", async () => {
    await setupLoaded({
      items: many(60),
      delay: (call) => (call.kind === "summary" ? 80 : 0),
    });
    expect(await screen.findByText("Mostrando 50 movimientos")).toBeTruthy();
    expect(await screen.findByText("Mostrando 50 de 60 movimientos")).toBeTruthy();
  });
});

describe("after registering, editing or deleting a movement", () => {
  it("refreshes the rows, the balance and the figure when the movements of the space are invalidated", async () => {
    const { state, queryClient } = await setupLoaded();
    expect(tableRows()).toHaveLength(5);
    // A new expense of 100 pesos on Itaú, as `MovementForm` registers it: the backend now sends
    // its row, the newest, with the balance that follows it; the form then invalidates the
    // movements of the space (and the accounts).
    state.items = [
      movementItem({
        id: "n0",
        date: "2026-10-28",
        description: "Taxi",
        amount_minor: -10000,
        category: TRANSPORTE,
        account: ITAU,
        balance_after_minor: 8415000,
      }),
      ...state.items,
    ];
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: transactionsQueryKey("s1") });
    });
    expect(await screen.findByText("Taxi")).toBeTruthy();
    expect(tableRows()).toHaveLength(6);
    expect(tableRows()[0]![4]).toBe("$\u00A084.150,00");
    expect(tableRows()[1]![4]).toBe("$\u00A084.250,00");
    // 45.350 - 100: the figure follows the new movement.
    await waitFor(() =>
      expect(text(detail().getByText("Movimiento neto de octubre").parentElement!)).toContain(
        "+$\u00A045.250,00",
      ),
    );
    expect(await screen.findByText("Mostrando 6 de 6 movimientos")).toBeTruthy();
  });

  it("takes a deleted movement out of the table and updates the count", async () => {
    const { state, queryClient } = await setupLoaded();
    state.items = state.items.filter((item) => item.id !== "i3");
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: transactionsQueryKey("s1") });
    });
    await waitFor(() => expect(screen.queryByText("UTE")).toBeNull());
    expect(tableRows()).toHaveLength(4);
    expect(await screen.findByText("Mostrando 4 de 4 movimientos")).toBeTruthy();
  });

  it("also refreshes after reconciling the account: the adjustment appears (the space is invalidated)", async () => {
    const { state, queryClient } = await setupLoaded();
    state.items = [
      adjustmentItem({
        id: "adj",
        date: "2026-10-28",
        description: "Ajuste de saldo",
        amount_minor: 120000,
        account: ITAU,
        balance_after_minor: 8545000,
      }),
      ...state.items,
    ];
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["spaces", "s1"] });
    });
    expect(await screen.findByText("Ajuste de saldo")).toBeTruthy();
  });
});

describe("the layout of the screen (classes: jsdom has no CSS)", () => {
  it("wraps the list and the detail as the canvas draws it, and gives the detail room to grow", async () => {
    await setupLoaded();
    const detailRegion = screen.getByRole("region", { name: "Itaú" });
    const column = detailRegion.parentElement!;
    expect(column.className).toContain("lg:basis-120");
    expect(column.className).toContain("lg:grow-999");
    expect(column.className).toContain("min-w-0");
    const row = column.parentElement!;
    expect(row.className).toContain("lg:flex-wrap");
    const list = row.firstElementChild as HTMLElement;
    expect(list.className).toContain("lg:basis-80");
    expect(list.className).toContain("lg:max-w-100");
    expect(detailRegion.className).toContain("hidden");
    expect(detailRegion.className).toContain("lg:flex");
  });

  it("sizes the controls of the header as the canvas: 36 px, radius 10, 44 for a finger", async () => {
    await setupLoaded();
    const month = detail().getByRole("combobox", { name: "Mes" });
    const filter = detail().getByRole("button", { name: "Filtrar" });
    for (const control of [month, filter]) {
      expect(control.className).toContain("h-9");
      expect(control.className).toContain("pointer-coarse:h-11");
      expect(control.className).toContain("rounded-tooltip");
    }
    expect(detail().getByRole("heading", { name: "Movimientos" }).className).toContain(
      "text-section-title",
    );
  });
});

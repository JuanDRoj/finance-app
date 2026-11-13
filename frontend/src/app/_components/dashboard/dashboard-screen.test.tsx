import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDashboardAmount } from "@/lib/core/dashboard";
import { DASHBOARD_SCENARIOS, type DashboardScenario, type ScenarioId } from "./dashboard-fixtures";
import { DashboardScreen } from "./dashboard-screen";
import {
  scriptedDashboardApi,
  type DashboardCallKind,
  type DashboardFault,
} from "./scripted-dashboard-api";

// The Inicio of a space with accounts (FE-24, KAN-84): the real screen and its cards, with the scripted
// backend of the dashboard (the 11 scenarios of the fixtures) and the width as a switch. The charts
// have their own tests: here they are stand-ins that record what they receive. jsdom has no CSS, so
// what a width hides is checked in the classes (`max-lg:hidden`, `lg:hidden`) and what a width does not
// ask for, in the requests.
const mocks = vi.hoisted(() => ({
  desktop: true,
  netChart: vi.fn(),
  barsChart: vi.fn(),
}));

vi.mock("@/components/use-is-desktop", () => ({
  DESKTOP_MEDIA_QUERY: "(min-width: 64rem)",
  useIsDesktop: () => mocks.desktop,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("./net-chart", () => ({
  NetChart: (props: unknown) => {
    mocks.netChart(props);
    return <div data-testid="net-chart" />;
  },
}));
vi.mock("./income-expense-chart", () => ({
  IncomeExpenseChart: (props: unknown) => {
    mocks.barsChart(props);
    return <div data-testid="bars-chart" />;
  },
  IncomeExpenseLegend: () => <ul aria-label="Leyenda del gráfico" />,
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const NBSP = " ";
const MINUS = "−";
const SPACE_ID = "00000000-0000-4000-8000-000000000000";

/** What `getByText` looks for: it turns the no-break space of an amount into a normal one. */
const asText = (text: string) => text.replace(/\s/g, " ");

type Faults = Partial<Record<DashboardCallKind, DashboardFault>>;

type Setup = {
  scenario?: ScenarioId | DashboardScenario;
  /** The space's day; the scenario's by default. */
  today?: string;
  currentMonth?: string;
  faults?: Faults;
  delay?: number;
  currencyCard?: ReactNode;
};

function setup(options: Setup = {}) {
  const chosen = options.scenario ?? "canvas";
  const scenario: DashboardScenario =
    typeof chosen === "string" ? DASHBOARD_SCENARIOS[chosen] : chosen;
  const faults: Faults = { ...options.faults };
  const api = scriptedDashboardApi({
    scenario: () => scenario,
    fault: (call) => faults[call.kind],
    delay: () => options.delay ?? 0,
  });
  const today = options.today ?? scenario.today;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <DashboardScreen
        space={{ id: SPACE_ID, currency: scenario.currency }}
        currentMonth={options.currentMonth ?? today.slice(0, 7)}
        today={today}
        api={api}
        currencyCard={options.currencyCard}
      />
    </QueryClientProvider>,
  );
  return { ...view, api, faults, scenario, client };
}

/** The screen once its figures are there (the first thing that arrives is the dashboard). */
async function loaded() {
  await screen.findByText("$ 96.430,00");
}

const region = (name: string | RegExp) => screen.getByRole("region", { name });
const kindsAsked = (api: { calls: Array<{ kind: DashboardCallKind }> }) =>
  api.calls.map((call) => call.kind);

beforeEach(() => {
  mocks.desktop = true;
  mocks.netChart.mockReset();
  mocks.barsChart.mockReset();
});

describe("DashboardScreen below 1024 px (a phone or a tablet)", () => {
  beforeEach(() => {
    mocks.desktop = false;
  });

  it("asks only for the dashboard and the accounts: no series and no movements, they have no card", async () => {
    const { api } = setup();
    await loaded();
    await waitFor(() => expect(kindsAsked(api)).toContain("accounts"));
    expect(kindsAsked(api).sort()).toEqual(["accounts", "dashboard"]);
  });

  it("writes the Neto with the month in a chip, and no change, no chart and no cricket's words", async () => {
    setup();
    await loaded();
    const neto = region("Neto");
    expect(within(neto).getByText("$ 96.430,00")).toBeTruthy();
    expect(within(neto).getByText("Tu disponible menos la deuda de tarjetas")).toBeTruthy();
    const month = within(neto).getByText("Octubre");
    expect(month.className).toContain("lg:hidden");
    // The change of the month is a desktop chip, and it needs the series, which a phone does not ask for.
    expect(neto.querySelector("[data-slot='net-change']")).toBeNull();
    expect(screen.queryByText(/últimos 6 meses/)).toBeNull();
  });

  it("gives the Neto the sizes of the canvas: 36 px on a phone, 42 from 768 px", async () => {
    setup();
    await loaded();
    const figure = within(region("Neto")).getByText("$ 96.430,00");
    expect(figure.className).toContain("text-4xl");
    expect(figure.className).toContain("md:text-net");
    expect(figure.className).toContain("wrap-anywhere");
  });

  it("shows Disponible and Deuda de tarjetas, the debt in its color and only when something is owed", async () => {
    setup();
    await loaded();
    const available = region("Disponible");
    expect(within(available).getByText("$ 128.900,00").className).not.toContain("text-debt");
    const debt = region("Deuda de tarjetas");
    expect(within(debt).getByText("$ 32.470,00").className).toContain("text-debt");
    await within(debt).findByText("En 2 tarjetas");
  });

  it("puts the note of Disponible only from 768 px, as the canvas does, and the one of Deuda always", async () => {
    setup();
    const note = await within(region("Disponible")).findByText("2 bancos y efectivo");
    expect(note.className).toContain("max-md:hidden");
    expect(within(region("Deuda de tarjetas")).getByText("En 2 tarjetas").className).not.toContain(
      "max-md:hidden",
    );
  });

  it("draws 'Gastos de octubre' with the top 5 and 'Ver todo', and neither a total nor a comparison", async () => {
    setup();
    await loaded();
    const top = region(/Gastos por categoría/);
    // Both titles are in the markup; CSS shows one at each width.
    const [phoneTitle, desktopTitle] = Array.from(top.querySelectorAll<HTMLElement>("h2 > span"));
    expect(phoneTitle?.textContent).toBe("Gastos de octubre");
    expect(phoneTitle?.className).toContain("lg:hidden");
    expect(desktopTitle?.textContent).toBe("Gastos por categoría");
    expect(desktopTitle?.className).toContain("max-lg:hidden");
    const link = within(top).getByRole("link", { name: /^Ver todo/ });
    expect(link.getAttribute("href")).toBe("/movimientos?tipo=gastos");
    expect(within(top).getAllByRole("listitem")).toHaveLength(5);
    // The tile with the total and its comparison is a desktop one.
    const tile = region("Gastos de octubre");
    expect(tile.className).toContain("max-lg:hidden");
  });

  it("hides the cards of the charts, the movements and the accounts below 1024 px", async () => {
    setup();
    await loaded();
    for (const name of ["Ingresos y gastos", "Últimos movimientos", "Cuentas"]) {
      expect(region(name).className).toContain("max-lg:hidden");
    }
  });
});

describe("DashboardScreen from 1024 px (a desktop)", () => {
  it("asks for the four things of the screen", async () => {
    const { api } = setup();
    await loaded();
    await waitFor(() => expect(new Set(kindsAsked(api)).size).toBe(4));
    expect(new Set(kindsAsked(api))).toEqual(
      new Set(["dashboard", "series", "recent", "accounts"]),
    );
    const series = api.calls.find((call) => call.kind === "series");
    expect(series?.query.months).toBe(6);
    expect(api.calls.find((call) => call.kind === "recent")?.query.limit).toBe(6);
  });

  it("writes the change of the month in a chip beside the Neto, and 'últimos 6 meses' under it", async () => {
    setup();
    await loaded();
    const neto = region("Neto");
    // `getByText` turns the no-break space of an amount into a normal one: it is written with one here.
    const chip = await within(neto).findByText("+$ 4.330,00 este mes");
    expect(chip.className).toContain("max-lg:hidden");
    expect(chip.getAttribute("data-direction")).toBe("up");
    expect(chip.className).toContain("bg-primary-soft");
    expect(within(neto).getByText(/últimos 6 meses/)).toBeTruthy();
  });

  it("hands the evolution the series and the currency of the space", async () => {
    const { scenario } = setup();
    await loaded();
    await screen.findByTestId("net-chart");
    expect(mocks.netChart).toHaveBeenLastCalledWith({
      points: scenario.series,
      currency: scenario.currency,
    });
  });

  it("peeks the cricket over the card, decorative and only on a desktop", async () => {
    setup();
    await loaded();
    const peek = region("Neto").querySelector("img[src*='kanza-peek']");
    expect(peek?.getAttribute("alt")).toBe("");
    expect(peek?.className).toContain("max-lg:hidden");
    expect(peek?.className).toContain("pointer-events-none");
  });

  /** The canvas with today's net changed: the chip is today's net minus the close of September ($ 92.100,00). */
  function canvasWithNet(netMinor: number): DashboardScenario {
    const canvas = DASHBOARD_SCENARIOS.canvas;
    return { ...canvas, dashboard: { ...canvas.dashboard, net_minor: netMinor } };
  }

  async function changeChip(): Promise<HTMLElement> {
    const neto = region("Neto");
    return waitFor(() => {
      const found = neto.querySelector<HTMLElement>("[data-slot='net-change']");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
  }

  it("draws the chip of a rise in green", async () => {
    setup({ scenario: "negative-net" });
    // −$ 3.500,00 today after −$ 26.200,00 at the close of September: it rose.
    expect(await within(region("Neto")).findByText("−$ 3.500,00")).toBeTruthy();
    const chip = await changeChip();
    expect(chip.getAttribute("data-direction")).toBe("up");
    expect(chip.className).toContain("bg-primary-soft");
    expect(chip.className).not.toContain("bg-foreground/6");
  });

  it("draws the chip of a fall neutral, with the minus", async () => {
    setup({ scenario: canvasWithNet(9_000_000) });
    expect(await within(region("Neto")).findByText("$ 90.000,00")).toBeTruthy();
    const chip = await changeChip();
    expect(chip.getAttribute("data-direction")).toBe("down");
    expect(chip.textContent).toBe(`${MINUS}$${NBSP}2.100,00 este mes`);
    expect(chip.className).toContain("bg-foreground/6");
    expect(chip.className).toContain("text-muted-foreground");
    expect(chip.className).not.toContain("bg-primary-soft");
  });

  it("draws the chip of no change neutral too, and says so", async () => {
    setup({ scenario: canvasWithNet(9_210_000) });
    expect(await within(region("Neto")).findByText("$ 92.100,00")).toBeTruthy();
    const chip = await changeChip();
    expect(chip.getAttribute("data-direction")).toBe("flat");
    expect(chip.textContent).toBe("Sin cambios este mes");
    expect(chip.className).toContain("bg-foreground/6");
  });

  it("tells what was spent in the month with its comparison with the month before", async () => {
    setup();
    await loaded();
    const tile = region("Gastos de octubre");
    expect(within(tile).getByText("$ 36.770,00")).toBeTruthy();
    expect(await within(tile).findByText("8 % menos que en setiembre")).toBeTruthy();
  });

  it("leaves the comparison out before the 15th, when a month that has just begun would be set against a whole one", async () => {
    const { api } = setup({ today: "2026-10-03" });
    await loaded();
    await waitFor(() => expect(kindsAsked(api)).toContain("series"));
    await screen.findByTestId("net-chart");
    expect(screen.queryByText(/menos que en|más que en|Igual que en/)).toBeNull();
    expect(within(region("Gastos de octubre")).getByText("$ 36.770,00")).toBeTruthy();
  });

  it("titles the bars card with its months and the legend", async () => {
    const { scenario } = setup();
    await loaded();
    const card = region("Ingresos y gastos");
    expect(await within(card).findByText("Últimos 6 meses · octubre en curso")).toBeTruthy();
    expect(within(card).getByRole("list", { name: "Leyenda del gráfico" })).toBeTruthy();
    await within(card).findByTestId("bars-chart");
    expect(mocks.barsChart).toHaveBeenLastCalledWith({
      points: scenario.series,
      currency: scenario.currency,
    });
  });

  it("lists the six latest movements in the compact table, with 'Ver todos'", async () => {
    setup();
    await loaded();
    const card = region("Últimos movimientos");
    const table = await within(card).findByRole("table", { name: "Últimos movimientos" });
    expect(table.closest("[data-slot='movements-table']")?.getAttribute("data-variant")).toBe(
      "compact",
    );
    const rows = within(table).getAllByRole("row");
    // The header and six movements; no "Acciones" column and no "Eliminar".
    expect(rows).toHaveLength(7);
    expect(within(table).getByText("Tienda Inglesa")).toBeTruthy();
    expect(within(table).queryByRole("columnheader", { name: "Acciones" })).toBeNull();
    expect(within(table).queryByRole("button", { name: /^Eliminar/ })).toBeNull();
    expect(within(card).getByRole("link", { name: "Ver todos" }).getAttribute("href")).toBe(
      "/movimientos",
    );
  });

  it("opens a movement from its description, over this screen", async () => {
    setup();
    await loaded();
    const table = await screen.findByRole("table", { name: "Últimos movimientos" });
    const link = within(table).getByRole("link", { name: "Tienda Inglesa" });
    expect(link.getAttribute("href")).toContain("movimiento=editar");
    expect(link.getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("lists the accounts with 'Ver cuentas': the debt of a card positive and in its color, no second line", async () => {
    setup();
    await loaded();
    const card = region("Cuentas");
    const rows = await within(card).findAllByRole("listitem");
    expect(rows).toHaveLength(5);
    const visa = rows.find((row) => within(row).queryByText("Visa Itaú"));
    expect(within(visa as HTMLElement).getByText("$ 24.120,00").className).toContain("text-debt");
    const itau = rows.find((row) => within(row).queryByText("Itaú"));
    expect(within(itau as HTMLElement).getByText("$ 84.250,00").className).not.toContain(
      "text-debt",
    );
    // The canvas draws no "Cierra el 5 · vence el 12" under the name.
    expect(within(card).queryByText(/Cierra el/)).toBeNull();
    expect(within(card).getByRole("link", { name: "Ver cuentas" }).getAttribute("href")).toBe(
      "/cuentas",
    );
    expect(
      within(visa as HTMLElement)
        .getByRole("link")
        .getAttribute("href"),
    ).toMatch(/^\/cuentas\/00000000-0000-4000-8000-0000000002/);
  });

  it("lists at most eight accounts, and 'Ver cuentas' leads to the rest", async () => {
    setup({ scenario: "many-accounts" });
    const card = region("Cuentas");
    const rows = await within(card).findAllByRole("listitem");
    expect(rows).toHaveLength(8);
    expect(within(card).getByRole("link", { name: "Ver cuentas" })).toBeTruthy();
  });

  it("puts the card of the currency at the end, after Cuentas", async () => {
    setup({ currencyCard: <section aria-label="Moneda de tu espacio" /> });
    await loaded();
    const currency = region("Moneda de tu espacio");
    const accounts = region("Cuentas");
    expect(
      accounts.compareDocumentPosition(currency) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Below 1024 px it follows the top 5, which is the last card a phone shows.
    const top = region(/Gastos por categoría/);
    expect(top.compareDocumentPosition(currency) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(currency.parentElement?.className).toContain("col-span-2");
  });

  it("draws no card of the currency when the page does not send it", async () => {
    setup();
    await loaded();
    expect(screen.queryByRole("region", { name: "Moneda de tu espacio" })).toBeNull();
  });
});

describe("the top 5", () => {
  it("writes each row as name, share and amount, with a bar relative to the largest", async () => {
    setup();
    await loaded();
    const top = region(/Gastos por categoría/);
    const rows = within(top).getAllByRole("listitem");
    const expected = [
      ["Comida", `58${NBSP}%`, "$ 21.230,00", "100%"],
      ["Transporte", `17${NBSP}%`, "$ 6.120,00", "29%"],
      ["Hogar", `13${NBSP}%`, "$ 4.800,00", "23%"],
      ["Salud", `7${NBSP}%`, "$ 2.640,00", "12%"],
      ["Ocio", `5${NBSP}%`, "$ 1.980,00", "9%"],
    ];
    expected.forEach(([name, share, amount, width], index) => {
      const row = rows[index] as HTMLElement;
      expect(within(row).getByText(name as string)).toBeTruthy();
      expect(row.textContent).toContain(share);
      expect(within(row).getByText(amount as string)).toBeTruthy();
      // The bar is decorative and orange (the color of the expense series); the numbers are text.
      const track = row.querySelector("[aria-hidden='true']") as HTMLElement;
      expect(track.className).toContain("bg-primary/14");
      const bar = track.firstElementChild as HTMLElement;
      expect(bar.className).toContain("bg-chart-expense");
      expect(bar.style.width).toBe(width);
    });
  });

  it("makes each row a link to the expenses of that category, and has a name for the list", async () => {
    setup();
    await loaded();
    const top = region(/Gastos por categoría/);
    expect(within(top).getByRole("list", { name: "Gastos por categoría de octubre" })).toBeTruthy();
    const food = within(top).getByRole("link", { name: /Comida/ });
    expect(food.getAttribute("href")).toBe(
      "/movimientos?tipo=gastos&categoria_id=00000000-0000-4000-8000-000000000101",
    );
  });

  it("says the month in the links when the dashboard is not of the month the screen is in", async () => {
    // The dashboard came from the month before (a page kept open across midnight).
    setup({ currentMonth: "2026-11", today: "2026-11-01" });
    await loaded();
    const top = region(/Gastos por categoría/);
    expect(
      within(top)
        .getByRole("link", { name: /^Ver todo/ })
        .getAttribute("href"),
    ).toBe("/movimientos?mes=2026-10&tipo=gastos");
    expect(
      within(top)
        .getByRole("link", { name: /Comida/ })
        .getAttribute("href"),
    ).toBe(
      "/movimientos?mes=2026-10&tipo=gastos&categoria_id=00000000-0000-4000-8000-000000000101",
    );
  });

  it("has no 'Otros' row and no icon: what the canvas draws", async () => {
    setup();
    await loaded();
    const top = region(/Gastos por categoría/);
    expect(within(top).queryByText("Otros")).toBeNull();
    expect(top.querySelector("svg")).toBeNull();
    expect(top.querySelector("img")).toBeNull();
  });

  it("cuts a name of 80 characters with an ellipsis and keeps it whole in the title", async () => {
    setup({ scenario: "worst-case" });
    const top = region(/Gastos por categoría/);
    const rows = await within(top).findAllByRole("listitem");
    const name = within(rows[0] as HTMLElement).getByTitle(/./);
    expect(name.className).toContain("truncate");
    expect(name.getAttribute("title")?.length).toBeGreaterThan(40);
    expect(name.textContent).toBe(name.getAttribute("title"));
  });

  it("holds an amount at the limit of the backend whole, and lets it wrap instead of breaking the row", async () => {
    // Each category is at the most a single amount can be; the month's total is the one past it.
    setup({ scenario: "beyond-the-limit" });
    const top = region(/Gastos por categoría/);
    const rows = await within(top).findAllByRole("listitem");
    expect(rows).toHaveLength(2);
    const amount = within(rows[0] as HTMLElement).getByText("$ 90.071.992.547.409,91");
    expect(amount.className).toContain("wrap-anywhere");
    // The share is the backend's whole percent of a total that is not exact: still plain text.
    expect(rows[0]?.textContent).toContain(`50${NBSP}%`);
  });

  it("says there are no expenses yet, with a way to register one, and has no 'Ver todo'", async () => {
    setup({ scenario: "no-expenses" });
    await loaded();
    const top = region(/Gastos por categoría/);
    expect(await within(top).findByText("Aún no registras gastos en octubre.")).toBeTruthy();
    const register = within(top).getByRole("link", { name: "Registrar un gasto" });
    expect(register.getAttribute("href")).toBe("/?movimiento=nuevo");
    expect(within(top).queryByRole("link", { name: /^Ver todo/ })).toBeNull();
    expect(within(top).queryByRole("list")).toBeNull();
  });
});

describe("the cases of the fixtures", () => {
  it("one month of history: no change chip, no words about six months and no comparison", async () => {
    const { api } = setup({ scenario: "one-month" });
    await loaded();
    await waitFor(() => expect(kindsAsked(api)).toContain("series"));
    await screen.findByTestId("net-chart");
    const neto = region("Neto");
    expect(neto.querySelector("[data-slot='net-change']")).toBeNull();
    expect(screen.queryByText(/últimos 6 meses · /)).toBeNull();
    expect(within(neto).queryByText(/últimos \d+ meses/)).toBeNull();
    expect(screen.queryByText(/menos que en|más que en|Igual que en/)).toBeNull();
    // The shells decide the text instead of a chart; the screen still hands them the series.
    expect(mocks.netChart).toHaveBeenCalled();
  });

  it("no movements at all: zeros, the notes of the accounts and an invitation in the table", async () => {
    setup({ scenario: "no-movements" });
    await screen.findAllByText("$ 0,00");
    const table = region("Últimos movimientos");
    expect(await within(table).findByText(/Aún no tienes movimientos/)).toBeTruthy();
    expect(within(table).getByRole("link", { name: "Registrar movimiento" })).toBeTruthy();
    expect(within(table).queryByRole("table")).toBeNull();
    expect(within(region("Neto")).queryByText(/este mes/)).toBeNull();
  });

  it("a negative Neto is written with the typographic minus", async () => {
    setup({ scenario: "negative-net" });
    const neto = region("Neto");
    expect(await within(neto).findByText("−$ 3.500,00")).toBeTruthy();
  });

  it("amounts past the safe integer say 'Más de' instead of an exact figure", async () => {
    const { scenario } = setup({ scenario: "beyond-the-limit" });
    const expected = formatDashboardAmount(scenario.dashboard.net_minor, scenario.currency);
    expect(expected).toMatch(/^(Más|Menos) de /);
    expect(await within(region("Neto")).findByText(asText(expected))).toBeTruthy();
    expect(await within(region("Disponible")).findByText(/^Más de /)).toBeTruthy();
  });

  it("amounts at the limit of the backend are written whole", async () => {
    setup({ scenario: "at-the-limit" });
    expect(await screen.findAllByText(/90\.071\.992\.547\.409,91/)).not.toHaveLength(0);
  });

  it.each(["exponent-0", "exponent-3"] as const)(
    "writes every figure with the exponent of the currency: %s",
    async (id) => {
      const { scenario } = setup({ scenario: id });
      const neto = region("Neto");
      const expected = formatDashboardAmount(scenario.dashboard.net_minor, scenario.currency);
      expect(await within(neto).findByText(asText(expected))).toBeTruthy();
      const decimals = scenario.currency.exponent;
      // Exactly `exponent` decimals: none for the Chilean peso, three for the dinar.
      expect(expected.includes(",")).toBe(decimals > 0);
      if (decimals > 0) expect(expected).toMatch(new RegExp(`,\\d{${decimals}}$`));
      expect(
        within(region("Disponible")).getByText(
          asText(formatDashboardAmount(scenario.dashboard.available_minor, scenario.currency)),
        ),
      ).toBeTruthy();
    },
  );

  it("long names and descriptions of 80 and 200 characters do not break the cards", async () => {
    setup({ scenario: "worst-case" });
    const cuentas = region("Cuentas");
    const rows = await within(cuentas).findAllByRole("listitem");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const name = within(row).getByTitle(/./);
      expect(name.className).toContain("truncate");
    }
    const table = await screen.findByRole("table", { name: "Últimos movimientos" });
    expect(within(table).getAllByRole("row").length).toBeGreaterThan(1);
  });

  it("never shows the raw values of the backend", async () => {
    setup();
    await loaded();
    await screen.findByRole("table", { name: "Últimos movimientos" });
    expect(
      screen.queryByText(/\b(bank|cash|credit_card|expense|income|transfer|confirmed)\b/),
    ).toBeNull();
  });
});

describe("the states", () => {
  it("holds a skeleton in each card while the answers do not come, and says nothing else", () => {
    setup({ delay: 60_000 });
    for (const name of ["Neto", "Disponible", "Deuda de tarjetas", "Gastos de octubre"]) {
      expect(region(name).getAttribute("aria-busy")).toBe("true");
    }
    expect(region(/Gastos por categoría/).getAttribute("aria-busy")).toBe("true");
    expect(region("Ingresos y gastos").getAttribute("aria-busy")).toBe("true");
    expect(region("Últimos movimientos").getAttribute("aria-busy")).toBe("true");
    expect(region("Cuentas").getAttribute("aria-busy")).toBe("true");
    // The title of the top card still says the month, from the screen's own.
    expect(screen.getAllByText("Gastos de octubre").length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/Aún no/)).toBeNull();
  });

  it("when the dashboard fails the Neto and the tiles give way to one error with 'Reintentar'", async () => {
    const { faults } = setup({ faults: { dashboard: "server" } });
    // The error of the summary is one; the top 5 gives its own, shorter one (below).
    const alert = (await screen.findByText("No se pudo cargar tu resumen")).closest(
      "[role='alert']",
    ) as HTMLElement;
    expect(alert).not.toBeNull();
    // What to do and that the data is safe, in Spanish: the title of the card plus the text of the error.
    expect(alert.textContent).toContain("Inténtalo de nuevo en unos minutos");
    expect(alert.textContent).toContain("Tus datos están a salvo");
    expect(screen.queryByText(/Internal server error|internal_error/)).toBeNull();
    expect(screen.queryByRole("region", { name: "Neto" })).toBeNull();
    // The top 5 gives its own short error; the cards that do not depend on it carry on.
    await within(region(/Gastos por categoría/)).findByText("No se pudieron cargar los gastos");
    await within(region("Cuentas")).findByText("$ 84.250,00");

    faults.dashboard = undefined;
    fireEvent.click(within(alert).getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("$ 96.430,00")).toBeTruthy();
    expect(screen.queryByText("No se pudo cargar tu resumen")).toBeNull();
  });

  it("when the series fails the figures stay, the chip and the comparison go, and the two charts say so", async () => {
    const { faults } = setup({ faults: { series: "offline" } });
    await loaded();
    const neto = region("Neto");
    expect(await within(neto).findByText("No se pudo cargar la evolución")).toBeTruthy();
    expect(within(neto).getByText("$ 96.430,00")).toBeTruthy();
    expect(neto.querySelector("[data-slot='net-change']")).toBeNull();
    const bars = region("Ingresos y gastos");
    expect(
      await within(bars).findByText("No se pudieron cargar los ingresos y gastos"),
    ).toBeTruthy();
    expect(within(bars).getByText(/No pudimos conectar|Revisa tu conexión/)).toBeTruthy();
    expect(screen.queryByText(/menos que en|más que en/)).toBeNull();
    // The rest of the screen carries on.
    expect(within(region("Gastos de octubre")).getByText("$ 36.770,00")).toBeTruthy();
    expect(within(region(/Gastos por categoría/)).getAllByRole("listitem")).toHaveLength(5);

    faults.series = undefined;
    fireEvent.click(within(bars).getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByTestId("bars-chart")).toBeTruthy();
    expect(await screen.findByText("+$ 4.330,00 este mes")).toBeTruthy();
  });

  it("when the latest movements fail the table says so, never that there are none", async () => {
    const { faults } = setup({ faults: { recent: "server" } });
    await loaded();
    const card = region("Últimos movimientos");
    expect(
      await within(card).findByText("No se pudieron cargar tus últimos movimientos"),
    ).toBeTruthy();
    expect(within(card).queryByText(/Aún no tienes movimientos/)).toBeNull();

    faults.recent = undefined;
    fireEvent.click(within(card).getByRole("button", { name: "Reintentar" }));
    expect(await within(card).findByRole("table")).toBeTruthy();
  });

  it("when the accounts fail the card says so and the notes of the tiles are left out", async () => {
    const { faults } = setup({ faults: { accounts: "server" } });
    await loaded();
    const card = region("Cuentas");
    expect(await within(card).findByText("No se pudieron cargar tus cuentas")).toBeTruthy();
    expect(within(card).queryByRole("listitem")).toBeNull();
    expect(screen.queryByText(/bancos y efectivo|En \d+ tarjetas/)).toBeNull();

    faults.accounts = undefined;
    fireEvent.click(within(card).getByRole("button", { name: "Reintentar" }));
    expect(await within(card).findByText("Visa Itaú")).toBeTruthy();
    expect(await screen.findByText("En 2 tarjetas")).toBeTruthy();
  });

  it("a space that is not the person's (404) is an error like any other, not an empty dashboard", async () => {
    setup({ faults: { dashboard: "not-found" } });
    expect(await screen.findByText("No se pudo cargar tu resumen")).toBeTruthy();
    expect(screen.queryByText("$ 0,00")).toBeNull();
    expect(screen.queryByRole("region", { name: "Neto" })).toBeNull();
  });
});

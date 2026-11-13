import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCENARIO_LIST, type ScenarioId } from "@/app/_components/dashboard/dashboard-fixtures";
import { DashboardScreenDemo } from "./dashboard-screen-demos";

// The catalog's section of the Inicio's screen (FE-24 / KAN-84): the real screen with a scripted backend
// and selectors for the data, the day, the requests that fail and the card of the currency. It fails if
// a scenario stops being drawable or a selector stops reaching the screen. The charts and the host of the
// sheet have their own tests: here they are stand-ins.
const mocks = vi.hoisted(() => ({ desktop: true }));

vi.mock("@/components/use-is-desktop", () => ({
  DESKTOP_MEDIA_QUERY: "(min-width: 64rem)",
  useIsDesktop: () => mocks.desktop,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/catalog",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/movements/movement-panel", () => ({
  MovementPanelHost: () => <div data-testid="movement-panel-host" />,
}));
vi.mock("@/app/_components/dashboard/net-chart", () => ({
  NetChart: () => <div data-testid="net-chart" />,
}));
vi.mock("@/app/_components/dashboard/income-expense-chart", () => ({
  IncomeExpenseChart: () => <div data-testid="bars-chart" />,
  IncomeExpenseLegend: () => <ul aria-label="Leyenda del gráfico" />,
}));

const LOAD = { timeout: 15000 };

beforeEach(() => {
  mocks.desktop = true;
});
// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

function choose(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

const region = (name: string | RegExp) => screen.getByRole("region", { name });

describe("DashboardScreenDemo", () => {
  it("draws the screen of the canvas by default, with all its cards", async () => {
    render(<DashboardScreenDemo instant />);
    expect(await within(region("Neto")).findByText("$ 96.430,00", {}, LOAD)).toBeTruthy();
    expect(within(region("Disponible")).getByText("$ 128.900,00")).toBeTruthy();
    expect(within(region("Deuda de tarjetas")).getByText("$ 32.470,00")).toBeTruthy();
    expect(await within(region("Cuentas")).findAllByRole("listitem", {}, LOAD)).toHaveLength(5);
    expect(await within(region("Últimos movimientos")).findByRole("table", {}, LOAD)).toBeTruthy();
    expect(await screen.findByTestId("net-chart", {}, LOAD)).toBeTruthy();
    expect(await screen.findByTestId("bars-chart", {}, LOAD)).toBeTruthy();
    expect(screen.getByTestId("movement-panel-host")).toBeTruthy();
  });

  it("draws every scenario of the fixtures", async () => {
    render(<DashboardScreenDemo instant />);
    for (const scenario of SCENARIO_LIST) {
      choose("Qué datos hay", scenario.id satisfies ScenarioId);
      await waitFor(() => expect(region("Disponible").getAttribute("aria-busy")).toBeNull(), LOAD);
      expect(region("Neto").textContent).toMatch(/\d/);
      expect(screen.queryByRole("alert")).toBeNull();
    }
    // Eleven scenarios, each one a whole screen drawn again (40 accounts in one): more than the 5 s of a test.
  }, 60000);

  it("changes what is drawn with the data: a month without expenses invites to register one", async () => {
    render(<DashboardScreenDemo instant />);
    await within(region("Neto")).findByText("$ 96.430,00", {}, LOAD);
    choose("Qué datos hay", "no-expenses");
    expect(await screen.findByText("Aún no registras gastos en octubre.", {}, LOAD)).toBeTruthy();
  });

  it("makes a request fail on purpose, and the rest of the screen carries on", async () => {
    render(<DashboardScreenDemo instant />);
    choose(/Qué responden los últimos movimientos/, "server");
    expect(
      await screen.findByText("No se pudieron cargar tus últimos movimientos", {}, LOAD),
    ).toBeTruthy();
    expect(await within(region("Neto")).findByText("$ 96.430,00", {}, LOAD)).toBeTruthy();
    choose(/Qué responden los últimos movimientos/, "ok");
    expect(await within(region("Últimos movimientos")).findByRole("table", {}, LOAD)).toBeTruthy();
  });

  it("fails the dashboard itself: one error in the place of the Neto and the tiles", async () => {
    render(<DashboardScreenDemo instant />);
    choose(/Qué responde el resumen del mes/, "not-found");
    expect(await screen.findByText("No se pudo cargar tu resumen", {}, LOAD)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Neto" })).toBeNull();
  });

  it("changes the day: the comparison with the month before appears from the 15th", async () => {
    render(<DashboardScreenDemo instant />);
    expect(await screen.findByText("8 % menos que en setiembre", {}, LOAD)).toBeTruthy();
    choose("Qué día es hoy", "early");
    await waitFor(() => expect(screen.queryByText(/menos que en setiembre/)).toBeNull(), LOAD);
    choose("Qué día es hoy", "late");
    expect(await screen.findByText("8 % menos que en setiembre", {}, LOAD)).toBeTruthy();
  });

  it("shows or leaves out the card of the currency", async () => {
    render(<DashboardScreenDemo instant />);
    expect(region("Moneda de tu espacio")).toBeTruthy();
    choose("La tarjeta de la moneda", "no");
    expect(screen.queryByRole("region", { name: "Moneda de tu espacio" })).toBeNull();
  });

  it("starts the screen again with the button", async () => {
    render(<DashboardScreenDemo instant />);
    await within(region("Neto")).findByText("$ 96.430,00", {}, LOAD);
    fireEvent.click(screen.getByRole("button", { name: "Empezar de nuevo" }));
    expect(await within(region("Neto")).findByText("$ 96.430,00", {}, LOAD)).toBeTruthy();
  });

  it("says the charts, the table and the accounts are for 1024 px and more", () => {
    render(<DashboardScreenDemo instant />);
    expect(screen.getByText(/existen desde 1024 px/)).toBeTruthy();
  });
});

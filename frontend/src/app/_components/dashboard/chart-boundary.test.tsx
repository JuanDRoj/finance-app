import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DASHBOARD_SCENARIOS } from "./dashboard-fixtures";
import { ChartBoundary } from "./chart-boundary";

// A chart that cannot draw (its code did not load, or it throws) must not take the Inicio down.
vi.mock("@/components/use-is-desktop", () => ({
  DESKTOP_MEDIA_QUERY: "(min-width: 64rem)",
  useIsDesktop: () => true,
}));
vi.mock("./net-chart-body", () => {
  throw new Error("Loading chunk failed");
});

import { NetChart } from "./net-chart";

const MESSAGE = "No se pudo cargar el gráfico. Recarga la página.";

beforeEach(() => {
  // React logs the error it catches; the test knows about it.
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Broken(): never {
  throw new Error("boom");
}

describe("ChartBoundary", () => {
  it("shows its children while nothing fails", () => {
    render(
      <ChartBoundary kind="net">
        <p>El gráfico</p>
      </ChartBoundary>,
    );
    expect(screen.getByText("El gráfico")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says the chart could not load, in the height of the chart, when a child throws", () => {
    render(
      <ChartBoundary kind="bars">
        <Broken />
      </ChartBoundary>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(MESSAGE);
    expect(alert.className).toContain("h-[220px]");
  });

  it("is what the chart's shell does when the code of the chart does not arrive", async () => {
    const scenario = DASHBOARD_SCENARIOS.canvas;
    render(<NetChart points={scenario.series} currency={scenario.currency} />);
    expect((await screen.findByRole("alert", {}, { timeout: 15000 })).textContent).toBe(MESSAGE);
  }, 20000);
});

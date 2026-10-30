import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MovementFiltersCard } from "./movement-filters-card";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

describe("MovementFiltersCard", () => {
  it("is a region named Filtros with the month and the type", () => {
    render(
      <MovementFiltersCard
        filters={{ month: "2026-10" }}
        currentMonth="2026-10"
        onChange={() => {}}
      />,
    );
    const card = screen.getByRole("region", { name: "Filtros" });
    expect(within(card).getByRole("combobox", { name: "Mes" })).toBeTruthy();
    expect(within(card).getByRole("group", { name: "Tipo de movimiento" })).toBeTruthy();
  });

  it("shows the month and the type that are on", () => {
    render(
      <MovementFiltersCard
        filters={{ month: "2026-08", type: "income" }}
        currentMonth="2026-10"
        onChange={() => {}}
      />,
    );
    expect((screen.getByRole("combobox", { name: "Mes" }) as HTMLSelectElement).value).toBe(
      "2026-08",
    );
    expect(screen.getByRole("button", { name: "Ingresos" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("changes one filter at a time", () => {
    const onChange = vi.fn();
    render(
      <MovementFiltersCard
        filters={{ month: "2026-10" }}
        currentMonth="2026-10"
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Mes" }), {
      target: { value: "2026-09" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ month: "2026-09" });
    fireEvent.click(screen.getByRole("button", { name: "Gastos" }));
    expect(onChange).toHaveBeenLastCalledWith({ type: "expense" });
    fireEvent.click(screen.getByRole("button", { name: "Todos" }));
    expect(onChange).toHaveBeenLastCalledWith({ type: undefined });
  });

  it("is a solid card of radius 20 with one row that wraps, ready for more controls", () => {
    render(
      <MovementFiltersCard
        filters={{ month: "2026-10" }}
        currentMonth="2026-10"
        onChange={() => {}}
        className="x"
      />,
    );
    const card = screen.getByRole("region", { name: "Filtros" });
    for (const cls of ["rounded-card", "bg-surface", "flex-wrap", "gap-2.5", "x"]) {
      expect(card.className).toContain(cls);
    }
  });
});

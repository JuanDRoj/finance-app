import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { incomeItem, movementItem, transferItem } from "@/components/movements/movement-fixtures";
import type { MovementListItem } from "@/lib/core/data/transactions";
import { RecentMovementsCard } from "./recent-movements-card";
import type { Load } from "./use-dashboard-data";

// "Últimos movimientos" (FE-24, KAN-84), on its own: the short table, its link, and the states a card
// has when it is not the data. The screen's tests draw it inside the dashboard.

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const UYU = { code: "UYU", exponent: 2 };
const TODAY = "2026-10-21";

function load(overrides: Partial<Load<MovementListItem[]>> = {}): Load<MovementListItem[]> {
  return {
    data: [
      movementItem({ id: "m1", description: "Tienda Inglesa", date: "2026-10-20" }),
      incomeItem({ id: "m2", description: "Sueldo", date: "2026-10-01" }),
      transferItem({ id: "m3", description: "Pago de Visa", date: "2026-10-17" }),
    ],
    error: undefined,
    failed: false,
    busy: false,
    retry: vi.fn(),
    ...overrides,
  };
}

function card(recent: Load<MovementListItem[]>) {
  render(<RecentMovementsCard recent={recent} currency={UYU} today={TODAY} />);
  return screen.getByRole("region", { name: "Últimos movimientos" });
}

describe("RecentMovementsCard", () => {
  it("is a desktop card with the title, 'Ver todos' to Movimientos and the compact table", () => {
    const region = card(load());
    expect(region.className).toContain("max-lg:hidden");
    expect(
      within(region).getByRole("heading", { level: 2, name: "Últimos movimientos" }),
    ).toBeTruthy();
    expect(within(region).getByRole("link", { name: "Ver todos" }).getAttribute("href")).toBe(
      "/movimientos",
    );
    const table = within(region).getByRole("table", { name: "Últimos movimientos" });
    expect(table.closest("[data-slot='movements-table']")?.getAttribute("data-variant")).toBe(
      "compact",
    );
    // The header and the three movements; no column of actions and no way to delete from here.
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).queryByRole("button")).toBeNull();
    expect(within(table).queryByText("Acciones")).toBeNull();
  });

  it("writes the date of the space's year short, and the movement's own words", () => {
    const table = within(card(load())).getByRole("table");
    expect(within(table).getByText("20 oct.")).toBeTruthy();
    expect(within(table).getByRole("link", { name: "Tienda Inglesa" })).toBeTruthy();
    expect(within(table).getByRole("link", { name: "Sueldo" })).toBeTruthy();
  });

  it("opens a movement from its description: a link that writes its own address on the screen", () => {
    const link = within(card(load())).getByRole("link", { name: "Tienda Inglesa" });
    expect(link.getAttribute("href")).toBe("/movimientos?movimiento=editar&id=m1");
    expect(link.getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("holds the place of six rows with a skeleton while they load", () => {
    const region = card(load({ data: undefined }));
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(region.querySelectorAll("[data-slot='skeleton']")).toHaveLength(6);
    expect(within(region).queryByRole("table")).toBeNull();
    expect(within(region).queryByText(/Aún no tienes/)).toBeNull();
  });

  it("says it could not load them, never that there are none, and asks again with 'Reintentar'", () => {
    const retry = vi.fn();
    const region = card(load({ data: undefined, failed: true, retry }));
    expect(within(region).getByText("No se pudieron cargar tus últimos movimientos")).toBeTruthy();
    expect(within(region).queryByText(/Aún no tienes movimientos/)).toBeNull();
    expect(within(region).queryByRole("table")).toBeNull();
    fireEvent.click(within(region).getByRole("button", { name: "Reintentar" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("with no movements invites to register one, instead of drawing an empty table", () => {
    const region = card(load({ data: [] }));
    expect(within(region).getByText(/Aún no tienes movimientos/)).toBeTruthy();
    const register = within(region).getByRole("link", { name: "Registrar movimiento" });
    expect(register.getAttribute("href")).toBe("/?movimiento=nuevo");
    expect(within(region).queryByRole("table")).toBeNull();
    expect(region.getAttribute("aria-busy")).toBeNull();
  });

  it("keeps a table that scrolls sideways inside the card instead of widening the page", () => {
    const table = within(card(load())).getByRole("table");
    const scroller = table.closest("[data-slot='movements-table']") as HTMLElement;
    expect(scroller.className).toContain("overflow-x-auto");
  });

  it("lets a description of 200 characters wrap to two lines and keeps it whole in the title", () => {
    const long = "Una descripción larguísima ".repeat(8).trim();
    const table = within(
      card(load({ data: [movementItem({ id: "m9", description: long })] })),
    ).getByRole("table");
    const text = within(table).getByTitle(long);
    expect(text.className).toContain("line-clamp-2");
    expect(text.className).toContain("wrap-anywhere");
  });
});

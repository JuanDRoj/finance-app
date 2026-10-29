import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  MovementPiecesDemo,
  NAME_80,
  SUMMARIES,
  TEXT_200,
  TODAY,
  manyMovements,
  normalMovements,
  worstMovements,
} from "./movement-pieces-demos";

// The demo draws the real pieces of Movimientos with a dataset to choose. These tests keep the
// datasets honest (the limits of the backend, one of each type, the extremes the break-ui pass names)
// and check that the pieces take them without breaking. CSS is not applied in jsdom, so the phone's
// list and the table are both in the page here: the screen hides one with `lg:hidden`/`max-lg:hidden`.

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

function choose(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("the datasets", () => {
  it("has 80 and 200 characters exactly, the limits of the backend, and no trailing space", () => {
    expect([...NAME_80]).toHaveLength(80);
    expect([...TEXT_200]).toHaveLength(200);
    expect(NAME_80.endsWith(" ")).toBe(false);
    expect(TEXT_200.endsWith(" ")).toBe(false);
  });

  it("has the movements of the canvas: all four types, a transfer between two accounts, a today", () => {
    const items = normalMovements();
    expect(new Set(items.map((item) => item.type))).toEqual(
      new Set(["expense", "income", "transfer", "adjustment"]),
    );
    expect(items.some((item) => item.date === TODAY)).toBe(true);
    expect(items.every((item) => item.status === "confirmed")).toBe(true);
    // The list comes newest first, as the backend sends it.
    const dates = items.map((item) => item.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("has a worst case that reaches the limits: the largest amount, 80 and 200 characters, no text, other states", () => {
    const items = worstMovements();
    const amounts = items.map((item) => Math.abs(item.amount_minor));
    expect(Math.max(...amounts)).toBe(Number.MAX_SAFE_INTEGER);
    expect(items.some((item) => item.description === TEXT_200)).toBe(true);
    expect(items.some((item) => item.category?.name === NAME_80)).toBe(true);
    expect(items.some((item) => item.description === null)).toBe(true);
    expect(items.some((item) => item.category === null && item.type === "expense")).toBe(true);
    expect(items.some((item) => item.status === "pending")).toBe(true);
    expect(items.some((item) => item.status === "skipped")).toBe(true);
    expect(items.some((item) => /^x{200}$/.test(item.description ?? ""))).toBe(true);
    expect(items.some((item) => /\p{Script=Arabic}/u.test(item.description ?? ""))).toBe(true);
    expect(items.filter((item) => item.date === "2026-10-17").length).toBeGreaterThanOrEqual(100);
    expect(items.some((item) => item.date.startsWith("2025"))).toBe(true);
    const ids = items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Newest first, as the backend sends them: a day is one run of equal dates, never two groups.
    const dates = items.map((item) => item.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("has 500 movements over many days, each with its own id", () => {
    const items = manyMovements();
    expect(items).toHaveLength(500);
    expect(new Set(items.map((item) => item.id)).size).toBe(500);
    const dates = items.map((item) => item.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(new Set(dates).size).toBeGreaterThan(100);
  });
});

describe("MovementPiecesDemo", () => {
  it("shows the summary, the list of days, the table and the four states", () => {
    render(<MovementPiecesDemo />);
    expect(screen.getByRole("region", { name: "Resumen de Octubre 2026" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Hoy · miércoles 21 de octubre" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ayer · martes 20 de octubre" })).toBeTruthy();
    expect(screen.getByRole("table", { name: "Movimientos de Octubre 2026" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Cargando movimientos" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Aún no tienes movimientos" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "No hay movimientos con estos filtros" }),
    ).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("writes the canvas figures and the rows of the canvas", () => {
    render(<MovementPiecesDemo />);
    const summary = screen.getByRole("region", { name: "Resumen de Octubre 2026" });
    expect(summary.textContent).toContain("+$ 68.150,00");
    expect(summary.textContent).toContain("−$ 36.770,00");
    expect(summary.textContent).toContain("+$ 31.380,00");
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(normalMovements().length + 1);
    expect(within(table).getByText("Comida › Supermercado")).toBeTruthy();
    expect(within(table).getByText("Itaú → Visa Itaú")).toBeTruthy();
  });

  it("takes the worst case without breaking: every row is still there, no raw 'null' or 'undefined'", () => {
    render(<MovementPiecesDemo />);
    choose("Qué movimientos hay", "worst");
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(worstMovements().length + 1);
    // `getByText` normalizes the no-break space of an amount to a plain one.
    expect(within(table).getAllByText("+$ 90.071.992.547.409,91").length).toBeGreaterThan(0);
    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/\bnull\b|\bundefined\b|\[object/);
    // The movement with nothing to show says what it is.
    expect(within(table).getAllByText("Sin categoría").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("Pendiente").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("Omitido").length).toBeGreaterThan(0);
    // Titles of the groups: today, another year, and the crowded day, each its own group.
    expect(screen.getByRole("heading", { name: "Miércoles 31 de diciembre de 2025" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sábado 17 de octubre" })).toBeTruthy();
  });

  it("draws a day with a hundred movements as one group", () => {
    render(<MovementPiecesDemo />);
    choose("Qué movimientos hay", "worst");
    const section = screen.getByRole("region", { name: "Sábado 17 de octubre" });
    expect(within(section).getAllByRole("listitem").length).toBeGreaterThanOrEqual(100);
  });

  it("changes the exponent of every amount with the currency", () => {
    render(<MovementPiecesDemo />);
    choose("Moneda del espacio", "CLP");
    const summary = screen.getByRole("region", { name: "Resumen de Octubre 2026" });
    // The amounts are in the minor unit: 6815000 with no decimals is 6.815.000.
    expect(summary.textContent).toContain("6.815.000");
    expect(summary.textContent).not.toContain("6.815.000,");
    choose("Moneda del espacio", "BHD");
    expect(screen.getByRole("region", { name: "Resumen de Octubre 2026" }).textContent).toContain(
      "6.815,000",
    );
  });

  it("swaps the summary: a loss, and the largest figures", () => {
    render(<MovementPiecesDemo />);
    choose("Qué suma el período", "loss");
    const summary = screen.getByRole("region", { name: "Resumen de Octubre 2026" });
    expect(summary.textContent).toContain("−$ 5.000,00");
    choose("Qué suma el período", "max");
    expect(screen.getByRole("region", { name: "Resumen de Octubre 2026" }).textContent).toContain(
      "90.071.992.547.409,91",
    );
    expect(SUMMARIES.max.income_minor).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("offers 'Nueva cuenta' in the empty state when asked, and 'Quitar filtros' only when there are filters", () => {
    render(<MovementPiecesDemo />);
    expect(screen.getByRole("link", { name: "Registrar movimiento" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Sin cuentas activas/));
    expect(screen.getByRole("link", { name: "Nueva cuenta" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quitar filtros" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Hay filtros además del mes/));
    expect(screen.queryByRole("button", { name: "Quitar filtros" })).toBeNull();
  });

  it("keeps the retry of the error busy when asked", () => {
    render(<MovementPiecesDemo />);
    fireEvent.click(screen.getByLabelText(/Pidiendo de nuevo/));
    expect(screen.getByRole("button", { name: "Reintentar" }).getAttribute("aria-busy")).toBe(
      "true",
    );
  });

  it("does not draw the 500 movements here (jsdom takes seconds): the dataset is checked above", () => {
    render(<MovementPiecesDemo limit={30} />);
    choose("Qué movimientos hay", "many");
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(31);
  });
});

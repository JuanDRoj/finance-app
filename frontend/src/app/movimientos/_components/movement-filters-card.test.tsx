import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import type { CategoryRead } from "@/lib/core/data/categories";
import type { MovementFilters } from "@/lib/core/movements";
import { MovementFiltersCard } from "./movement-filters-card";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const ACCOUNTS = [
  { id: "a1", name: "Itaú", archived_at: null },
  { id: "a2", name: "Efectivo", archived_at: null },
  { id: "a3", name: "BROU", archived_at: "2026-09-01T12:00:00Z" },
] as AccountWithBalance[];

const category = (id: string, name: string, over: Partial<CategoryRead> = {}): CategoryRead =>
  ({
    id,
    name,
    kind: "expense",
    icon: "tag",
    parent_id: null,
    archived_at: null,
    ...over,
  }) as CategoryRead;
const CATEGORIES = [
  category("c1", "Comida"),
  category("c2", "Supermercado", { parent_id: "c1" }),
  category("c3", "Trabajo", { kind: "income" }),
  category("c4", "Mascotas", { archived_at: "2026-09-01T12:00:00Z" }),
];

function renderCard(
  filters: MovementFilters = { month: "2026-10" },
  props: Partial<Parameters<typeof MovementFiltersCard>[0]> = {},
) {
  const onChange = vi.fn();
  render(
    <MovementFiltersCard
      filters={filters}
      currentMonth="2026-10"
      accounts={ACCOUNTS}
      categories={CATEGORIES}
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange, card: within(screen.getByRole("region", { name: "Filtros" })) };
}

describe("MovementFiltersCard", () => {
  it("is a region named Filtros with the search, the month, the account, the category and the type, in that order", () => {
    const { card } = renderCard();
    const controls = Array.from(
      screen
        .getByRole("region", { name: "Filtros" })
        .querySelectorAll("[role='search'], select, [role='group']"),
    ).map((node) => node.getAttribute("aria-label"));
    expect(controls).toEqual([
      "Buscar movimientos",
      "Mes",
      "Cuenta",
      "Categoría",
      "Tipo de movimiento",
    ]);
    expect(card.getByRole("searchbox", { name: "Buscar por descripción" })).toBeTruthy();
  });

  it("shows the filters that are on", () => {
    const { card } = renderCard({
      month: "2026-08",
      type: "income",
      q: "sueldo",
      accountId: "a2",
      categoryId: "c3",
    });
    expect((card.getByRole("combobox", { name: "Mes" }) as HTMLSelectElement).value).toBe(
      "2026-08",
    );
    expect(card.getByRole("button", { name: "Ingresos" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect((card.getByRole("searchbox") as HTMLInputElement).value).toBe("sueldo");
    expect((card.getByRole("combobox", { name: "Cuenta" }) as HTMLSelectElement).value).toBe("a2");
    expect((card.getByRole("combobox", { name: "Categoría" }) as HTMLSelectElement).value).toBe(
      "c3",
    );
  });

  it("changes one filter at a time", () => {
    const { card, onChange } = renderCard();
    fireEvent.change(card.getByRole("combobox", { name: "Mes" }), { target: { value: "2026-09" } });
    expect(onChange).toHaveBeenLastCalledWith({ month: "2026-09" });
    fireEvent.click(card.getByRole("button", { name: "Gastos" }));
    expect(onChange).toHaveBeenLastCalledWith({ type: "expense" });
    fireEvent.click(card.getByRole("button", { name: "Todos" }));
    expect(onChange).toHaveBeenLastCalledWith({ type: undefined });
    fireEvent.change(card.getByRole("combobox", { name: "Cuenta" }), { target: { value: "a1" } });
    expect(onChange).toHaveBeenLastCalledWith({ accountId: "a1" });
    fireEvent.change(card.getByRole("combobox", { name: "Categoría" }), {
      target: { value: "c1" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ categoryId: "c1" });
  });

  it("takes the account and the category off with 'Todas'", () => {
    const { card, onChange } = renderCard({ month: "2026-10", accountId: "a1", categoryId: "c1" });
    fireEvent.change(card.getByRole("combobox", { name: "Cuenta" }), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ accountId: undefined });
    fireEvent.change(card.getByRole("combobox", { name: "Categoría" }), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ categoryId: undefined });
  });

  it("searches after the pause, through the same change", () => {
    vi.useFakeTimers();
    try {
      const { card, onChange } = renderCard();
      fireEvent.change(card.getByRole("searchbox"), { target: { value: "uber" } });
      vi.advanceTimersByTime(400);
      expect(onChange).toHaveBeenLastCalledWith({ q: "uber" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts the search again when the reset key changes: no text and no pending search", () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const ui = (searchResetKey: number) => (
        <MovementFiltersCard
          filters={{ month: "2026-10" }}
          currentMonth="2026-10"
          accounts={ACCOUNTS}
          categories={CATEGORIES}
          onChange={onChange}
          searchResetKey={searchResetKey}
        />
      );
      const { rerender } = render(ui(0));
      const field = () => screen.getByRole("searchbox") as HTMLInputElement;
      fireEvent.change(field(), { target: { value: "x" } });
      // The same key keeps the text: only a clear changes it.
      rerender(ui(0));
      expect(field().value).toBe("x");
      rerender(ui(1));
      expect(field().value).toBe("");
      vi.advanceTimersByTime(1000);
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers the accounts, the active ones first and the archived ones with their mark", () => {
    const { card } = renderCard();
    const options = within(card.getByRole("combobox", { name: "Cuenta" })).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Todas las cuentas",
      "Itaú",
      "Efectivo",
      "BROU (archivada)",
    ]);
  });

  it("offers only the principal categories, in groups, as the sheet does", () => {
    const { card } = renderCard();
    const select = card.getByRole("combobox", { name: "Categoría" });
    expect(within(select).getByRole("group", { name: "Gastos" })).toBeTruthy();
    expect(within(select).getByRole("group", { name: "Ingresos" })).toBeTruthy();
    expect(within(select).getByRole("group", { name: "Archivadas" })).toBeTruthy();
    const names = within(select)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(names).toEqual(["Todas las categorías", "Comida", "Trabajo", "Mascotas (archivada)"]);
    expect(names).not.toContain("Supermercado");
  });

  it("names an account or a category the list does not know, instead of saying 'Todas'", () => {
    const { card } = renderCard({ month: "2026-10", accountId: "zzz", categoryId: "yyy" });
    const account = card.getByRole("combobox", { name: "Cuenta" }) as HTMLSelectElement;
    const category = card.getByRole("combobox", { name: "Categoría" }) as HTMLSelectElement;
    expect(account.selectedOptions[0]!.textContent).toBe("Otra cuenta");
    expect(category.selectedOptions[0]!.textContent).toBe("Otra categoría");
  });

  it("names a subcategory that the list knows in full", () => {
    const { card } = renderCard({ month: "2026-10", categoryId: "c2" });
    const category = card.getByRole("combobox", { name: "Categoría" }) as HTMLSelectElement;
    expect(category.selectedOptions[0]!.textContent).toBe("Comida › Supermercado");
  });

  it("turns a select off when its list did not load, unless something is chosen, which can be taken off", () => {
    const { card } = renderCard(
      { month: "2026-10" },
      { accounts: undefined, accountsFailed: true, categories: undefined, categoriesFailed: true },
    );
    expect((card.getByRole("combobox", { name: "Cuenta" }) as HTMLSelectElement).disabled).toBe(
      true,
    );
    expect(card.getByRole("combobox", { name: "Categoría" }).getAttribute("title")).toBe(
      "No se pudieron cargar tus categorías",
    );
    cleanup();
    const chosen = renderCard(
      { month: "2026-10", accountId: "a1" },
      { accounts: undefined, accountsFailed: true },
    );
    const account = chosen.card.getByRole("combobox", { name: "Cuenta" }) as HTMLSelectElement;
    expect(account.disabled).toBe(false);
    expect(account.selectedOptions[0]!.textContent).toBe("Otra cuenta");
  });

  it("is a solid card of radius 20 with one row that wraps, and the search takes the room that is left", () => {
    renderCard();
    const section = screen.getByRole("region", { name: "Filtros" });
    for (const cls of ["rounded-card", "bg-surface", "flex-wrap", "gap-2.5"]) {
      expect(section.className).toContain(cls);
    }
    const search = screen.getByRole("search");
    expect(search.className).toContain("flex-1");
    expect(search.className).toContain("basis-60");
  });

  it("takes the class the screen gives it", () => {
    renderCard({ month: "2026-10" }, { className: "x" });
    expect(screen.getByRole("region", { name: "Filtros" }).className).toContain("x");
  });
});

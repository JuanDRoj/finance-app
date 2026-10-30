import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import type { CategoryRead } from "@/lib/core/data/categories";
import { FilterSheet } from "./filter-sheet";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const ACCOUNTS = [
  { id: "a1", name: "Itaú", archived_at: null },
  { id: "a2", name: "Efectivo", archived_at: null },
  { id: "a3", name: "BROU", archived_at: "2026-09-01T12:00:00Z" },
] as AccountWithBalance[];

const category = (id: string, name: string, over: Partial<CategoryRead> = {}) =>
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

type Props = Partial<Parameters<typeof FilterSheet>[0]>;

function renderSheet(props: Props = {}) {
  const onOpenChange = vi.fn();
  const onApply = vi.fn();
  const onClear = vi.fn();
  const ui = (next: Props = {}) => (
    <FilterSheet
      open
      onOpenChange={onOpenChange}
      filters={{}}
      accounts={ACCOUNTS}
      categories={CATEGORIES}
      onApply={onApply}
      onClear={onClear}
      {...props}
      {...next}
    />
  );
  const view = render(ui());
  const dialog = () => within(screen.getByRole("dialog", { name: "Filtrar movimientos" }));
  const account = () => dialog().getByRole("combobox", { name: "Cuenta" }) as HTMLSelectElement;
  const category_ = () =>
    dialog().getByRole("combobox", { name: "Categoría" }) as HTMLSelectElement;
  return {
    onOpenChange,
    onApply,
    onClear,
    dialog,
    account,
    category: category_,
    rerender: (next: Props) => view.rerender(ui(next)),
  };
}

describe("FilterSheet", () => {
  it("is a dialog named 'Filtrar movimientos' with the account, the category and the two buttons", () => {
    const { dialog } = renderSheet();
    expect(screen.getByRole("dialog", { name: "Filtrar movimientos" })).toBeTruthy();
    expect(dialog().getByRole("combobox", { name: "Cuenta" })).toBeTruthy();
    expect(dialog().getByRole("combobox", { name: "Categoría" })).toBeTruthy();
    expect(dialog().getByRole("button", { name: "Quitar filtros" })).toBeTruthy();
    expect(dialog().getByRole("button", { name: "Ver movimientos" })).toBeTruthy();
  });

  it("explains that a principal category includes its subcategories", () => {
    const { dialog, category } = renderSheet();
    const help = dialog().getByText("Una categoría principal incluye sus subcategorías.");
    expect(category().getAttribute("aria-describedby")).toContain(help.id);
  });

  it("offers 'Todas las cuentas' and the accounts, the archived ones last with their mark", () => {
    const { account } = renderSheet();
    expect(
      within(account())
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Todas las cuentas", "Itaú", "Efectivo", "BROU (archivada)"]);
  });

  it("offers 'Todas las categorías' and only the principal ones, in Gastos, Ingresos and Archivadas", () => {
    const { category } = renderSheet();
    expect(
      within(category())
        .getAllByRole("group")
        .map((g) => g.getAttribute("label")),
    ).toEqual(["Gastos", "Ingresos", "Archivadas"]);
    expect(
      within(category())
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Todas las categorías", "Comida", "Trabajo", "Mascotas (archivada)"]);
  });

  it("starts from the account and the category that the URL says", () => {
    const { account, category } = renderSheet({ filters: { accountId: "a2", categoryId: "c3" } });
    expect(account().value).toBe("a2");
    expect(category().value).toBe("c3");
  });

  it("has selects of 48 px with the text of 16 px, so iOS does not zoom", () => {
    const { account } = renderSheet();
    expect(account().className).toContain("h-12");
    expect(account().className).toContain("text-base");
  });

  it("applies nothing until 'Ver movimientos', then applies both and closes", () => {
    const { account, category, dialog, onApply, onOpenChange } = renderSheet();
    fireEvent.change(account(), { target: { value: "a1" } });
    fireEvent.change(category(), { target: { value: "c1" } });
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(dialog().getByRole("button", { name: "Ver movimientos" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({ accountId: "a1", categoryId: "c1" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("applies 'Todas' as no filter", () => {
    const { dialog, onApply } = renderSheet({ filters: { accountId: "a1", categoryId: "c1" } });
    const selects = dialog().getAllByRole("combobox") as HTMLSelectElement[];
    for (const select of selects) fireEvent.change(select, { target: { value: "" } });
    fireEvent.click(dialog().getByRole("button", { name: "Ver movimientos" }));
    expect(onApply).toHaveBeenCalledWith({ accountId: undefined, categoryId: undefined });
  });

  it("clears the filters and closes with 'Quitar filtros', without applying the draft", () => {
    const { account, dialog, onApply, onClear, onOpenChange } = renderSheet({
      filters: { accountId: "a1" },
    });
    fireEvent.change(account(), { target: { value: "a2" } });
    fireEvent.click(dialog().getByRole("button", { name: "Quitar filtros" }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("throws the draft away when it is closed any other way: Escape does not apply", async () => {
    const { account, onApply, onOpenChange } = renderSheet();
    fireEvent.change(account(), { target: { value: "a1" } });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalled());
    // Base UI also hands over the reason ("escape-key") as a second argument.
    expect(onOpenChange.mock.calls[0]![0]).toBe(false);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("starts again from the URL every time it opens, not from what was left in it", () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(!open)}>cambiar</button>
          <FilterSheet
            open={open}
            onOpenChange={setOpen}
            filters={{ accountId: "a2" }}
            accounts={ACCOUNTS}
            categories={CATEGORIES}
            onApply={() => {}}
            onClear={() => {}}
          />
        </>
      );
    }
    render(<Harness />);
    const select = () => screen.getByRole("combobox", { name: "Cuenta" }) as HTMLSelectElement;
    fireEvent.change(select(), { target: { value: "a1" } });
    expect(select().value).toBe("a1");
    fireEvent.click(screen.getByText("cambiar"));
    fireEvent.click(screen.getByText("cambiar"));
    expect(select().value).toBe("a2");
  });

  it("names an account or a category the URL has and the list does not, instead of saying 'Todas'", () => {
    const { account, category } = renderSheet({ filters: { accountId: "zzz", categoryId: "yyy" } });
    expect(account().selectedOptions[0]!.textContent).toBe("Otra cuenta");
    expect(category().selectedOptions[0]!.textContent).toBe("Otra categoría");
  });

  it("keeps that extra choice in the list after the person picks another, so they can go back", () => {
    const { account } = renderSheet({ filters: { accountId: "zzz" } });
    fireEvent.change(account(), { target: { value: "a1" } });
    expect(within(account()).getByRole("option", { name: "Otra cuenta" })).toBeTruthy();
  });

  it("names a subcategory the list knows in full", () => {
    const { category } = renderSheet({ filters: { categoryId: "c2" } });
    expect(category().selectedOptions[0]!.textContent).toBe("Comida › Supermercado");
  });

  it("turns a select off, and says why, when its list did not load", () => {
    const { account, category, dialog } = renderSheet({
      accounts: undefined,
      accountsFailed: true,
      categories: undefined,
      categoriesFailed: true,
    });
    expect(account().disabled).toBe(true);
    expect(category().disabled).toBe(true);
    expect(dialog().getByText("No se pudieron cargar tus cuentas.")).toBeTruthy();
    expect(dialog().getByText("No se pudieron cargar tus categorías.")).toBeTruthy();
    expect(dialog().queryByText("Una categoría principal incluye sus subcategorías.")).toBeNull();
  });

  it("lets a chosen account be taken off even when the list did not load", () => {
    const { account } = renderSheet({
      accounts: undefined,
      accountsFailed: true,
      filters: { accountId: "a1" },
    });
    expect(account().disabled).toBe(false);
  });

  it("has no 'Cancelar' under the buttons: the foot is its own", () => {
    renderSheet();
    expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
  });

  it("has the two buttons of 52 px, the second taking the room, over a line", () => {
    const { dialog } = renderSheet();
    const clear = dialog().getByRole("button", { name: "Quitar filtros" });
    const apply = dialog().getByRole("button", { name: "Ver movimientos" });
    expect(clear.className).toContain("min-h-13");
    expect(apply.className).toContain("min-h-13");
    expect(apply.className).toContain("flex-1");
    expect(clear.parentElement!.className).toContain("border-t");
    expect(clear.parentElement!.className).toContain("flex-nowrap");
  });

  it("is centered and at most 640 px wide from 768 px, like the sheet of 'Registrar movimiento'", () => {
    renderSheet();
    const popup = screen.getByRole("dialog");
    expect(popup.className).toContain("md:mx-auto");
    expect(popup.className).toContain("md:max-w-160");
    expect(popup.getAttribute("data-side")).toBe("bottom");
  });

  it("holds names of 80 characters whole in the lists", () => {
    const long = "A".repeat(80);
    const { account } = renderSheet({
      accounts: [{ id: "a9", name: long, archived_at: null } as AccountWithBalance],
    });
    expect(within(account()).getByRole("option", { name: long })).toBeTruthy();
  });
});

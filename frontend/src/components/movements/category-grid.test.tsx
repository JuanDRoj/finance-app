import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCategoryTree } from "@/lib/core/categories";
import type { CategoryRead } from "@/lib/core/data/categories";
import { CategoryGrid } from "./category-grid";
import { CategorySelect } from "./category-select";
import { SubcategoryStep } from "./subcategory-step";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

function category(
  name: string,
  overrides: Partial<CategoryRead> = {},
  kind: CategoryRead["kind"] = "expense",
): CategoryRead {
  return {
    id: `cat-${name}`,
    kind,
    name,
    icon: "tag",
    parent_id: null,
    archived_at: null,
    ...overrides,
  };
}

const COMIDA = category("Comida", { icon: "fork-knife" });
const TRANSPORTE = category("Transporte", { icon: "car" });
const ROPA = category("Ropa", { icon: "t-shirt" });
const TAXI = category("Taxi y apps", { parent_id: TRANSPORTE.id, icon: "taxi" });
const COMBUSTIBLE = category("Combustible", { parent_id: TRANSPORTE.id, icon: "gas-pump" });
const SUPERMERCADO = category("Supermercado", { parent_id: COMIDA.id });
const TREE = buildCategoryTree(
  [COMIDA, TRANSPORTE, ROPA, TAXI, COMBUSTIBLE, SUPERMERCADO],
  "expense",
);

function renderGrid(props: Partial<Parameters<typeof CategoryGrid>[0]> = {}) {
  const onSelect = vi.fn();
  const onOpenSubcategories = vi.fn();
  const view = render(
    <CategoryGrid
      tree={TREE}
      value=""
      onSelect={onSelect}
      onOpenSubcategories={onOpenSubcategories}
      {...props}
    />,
  );
  return { ...view, onSelect, onOpenSubcategories };
}

const cell = (name: string) => screen.getByRole("button", { name });

describe("CategoryGrid", () => {
  it("is a group named 'Categoría' with a button per principal, in the order given", () => {
    renderGrid();
    const group = screen.getByRole("group", { name: "Categoría" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Comida", "Transporte", "Ropa"]);
  });

  it("is not a radio group: moving with the arrows must not open a step (WCAG 3.2.2)", () => {
    renderGrid();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    for (const button of screen.getAllByRole("button")) {
      expect(button.getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("draws four columns, each cell with its icon in a 44 px tile and the name under it", () => {
    const { container } = renderGrid();
    expect(container.querySelector(".grid")?.className).toContain("grid-cols-4");
    const tile = cell("Comida").querySelector("span[aria-hidden='true']") as HTMLElement;
    expect(tile.className).toContain("size-11");
    expect(tile.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    // 13 px, at most two lines, and the whole name for whoever hovers it.
    const name = cell("Comida").lastElementChild as HTMLElement;
    expect(name.className).toContain("text-caption");
    expect(name.className).toContain("line-clamp-2");
    expect(cell("Comida").getAttribute("title")).toBe("Comida");
  });

  it("chooses a principal with no subcategories when it is pressed, and opens no step", () => {
    const { onSelect, onOpenSubcategories } = renderGrid();
    fireEvent.click(cell("Ropa"));
    expect(onSelect).toHaveBeenCalledWith("cat-Ropa");
    expect(onOpenSubcategories).not.toHaveBeenCalled();
  });

  it("chooses a principal with subcategories and opens its second step", () => {
    const { onSelect, onOpenSubcategories } = renderGrid();
    fireEvent.click(cell("Transporte"));
    expect(onSelect).toHaveBeenCalledWith("cat-Transporte");
    expect(onOpenSubcategories).toHaveBeenCalledWith("cat-Transporte");
  });

  it("keeps a subcategory already chosen when its principal is pressed again", () => {
    const { onSelect, onOpenSubcategories } = renderGrid({ value: TAXI.id });
    fireEvent.click(cell("Transporte"));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenSubcategories).toHaveBeenCalledWith("cat-Transporte");
  });

  it("presses the principal of a subcategory chosen, and only it", () => {
    renderGrid({ value: TAXI.id });
    expect(cell("Transporte").getAttribute("aria-pressed")).toBe("true");
    expect(cell("Comida").getAttribute("aria-pressed")).toBe("false");
    expect(cell("Ropa").getAttribute("aria-pressed")).toBe("false");
  });

  it("writes the choice under the grid for a principal with subcategories, with 'Cambiar'", () => {
    const { onOpenSubcategories } = renderGrid({ value: TAXI.id });
    expect(screen.getByText("Transporte › Taxi y apps")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cambiar" }));
    expect(onOpenSubcategories).toHaveBeenCalledWith("cat-Transporte");
  });

  it("says 'Solo Transporte' when the principal itself is chosen", () => {
    renderGrid({ value: TRANSPORTE.id });
    expect(screen.getByText("Solo Transporte")).toBeTruthy();
  });

  it("writes nothing under the grid for a principal with no subcategories, or for no choice", () => {
    const { unmount } = renderGrid({ value: ROPA.id });
    expect(screen.queryByRole("button", { name: "Cambiar" })).toBeNull();
    unmount();
    renderGrid();
    expect(screen.queryByRole("button", { name: "Cambiar" })).toBeNull();
  });

  it("makes 'Cambiar' at least 44 px tall", () => {
    renderGrid({ value: TAXI.id });
    expect(screen.getByRole("button", { name: "Cambiar" }).className).toContain("min-h-11");
  });

  it("links an error to the group and marks it, with the text under the grid", () => {
    renderGrid({ error: "Elige una categoría." });
    const group = screen.getByRole("group", { name: "Categoría" });
    expect(group.getAttribute("data-invalid")).toBe("true");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Elige una categoría.");
    expect(group.getAttribute("aria-describedby")).toBe(alert.id);
  });

  it("gives the form the group to focus by script, which Tab does not stop at", () => {
    const ref = createRef<HTMLDivElement>();
    renderGrid({ ref });
    expect(ref.current).toBe(screen.getByRole("group", { name: "Categoría" }));
    expect(ref.current?.getAttribute("tabindex")).toBe("-1");
    ref.current?.focus();
    expect(document.activeElement).toBe(ref.current);
  });

  it("holds a name with no spaces in two lines at most, and never overflows its cell", () => {
    const long = "Supercalifragilisticoespialidosoextraordinariamentelargo";
    renderGrid({ tree: buildCategoryTree([category(long)], "expense") });
    const name = cell(long).lastElementChild as HTMLElement;
    expect(name.className).toContain("wrap-anywhere");
    expect(name.className).toContain("line-clamp-2");
    expect(cell(long).className).toContain("min-w-0");
  });

  it("draws an empty tree as an empty grid, without failing", () => {
    renderGrid({ tree: [] });
    expect(screen.getByRole("group", { name: "Categoría" })).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("SubcategoryStep", () => {
  const BRANCH = TREE[1]!;

  function renderStep(value = "", onChoose = vi.fn()) {
    const view = render(<SubcategoryStep branch={BRANCH} value={value} onChoose={onChoose} />);
    return { ...view, onChoose };
  }

  it("asks for a subcategory or leaves only the principal, with 'Solo X' first", () => {
    renderStep();
    expect(screen.getByText("Elige una subcategoría o deja solo Transporte.")).toBeTruthy();
    const group = screen.getByRole("group", { name: "Subcategoría de Transporte" });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((radio) => radio.parentElement?.textContent),
    ).toEqual(["Solo Transporte", "Taxi y apps", "Combustible"]);
  });

  it("checks the row of the choice: 'Solo X' for the principal, the subcategory for a sub", () => {
    const { unmount } = renderStep(TRANSPORTE.id);
    expect(
      (screen.getByRole("radio", { name: "Solo Transporte" }) as HTMLInputElement).checked,
    ).toBe(true);
    unmount();
    renderStep(TAXI.id);
    expect((screen.getByRole("radio", { name: "Taxi y apps" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(
      (screen.getByRole("radio", { name: "Solo Transporte" }) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("chooses a row when it is pressed, the one already checked included", () => {
    const { onChoose } = renderStep(TRANSPORTE.id);
    fireEvent.click(screen.getByRole("radio", { name: "Solo Transporte" }));
    expect(onChoose).toHaveBeenLastCalledWith("cat-Transporte");
    fireEvent.click(screen.getByRole("radio", { name: "Combustible" }));
    expect(onChoose).toHaveBeenLastCalledWith("cat-Combustible");
    expect(onChoose).toHaveBeenCalledTimes(2);
  });

  it("puts the focus on the row that is chosen, or on the first, as it appears", () => {
    const { unmount } = renderStep(COMBUSTIBLE.id);
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Combustible" }));
    unmount();
    renderStep("");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Solo Transporte" }));
  });

  it("moves the focus with the arrow keys without choosing anything (WCAG 3.2.2)", () => {
    const { onChoose } = renderStep(TRANSPORTE.id);
    const solo = screen.getByRole("radio", { name: "Solo Transporte" });
    const taxi = screen.getByRole("radio", { name: "Taxi y apps" });
    const combustible = screen.getByRole("radio", { name: "Combustible" });
    expect(document.activeElement).toBe(solo);
    fireEvent.keyDown(solo, { key: "ArrowDown" });
    expect(document.activeElement).toBe(taxi);
    fireEvent.keyDown(taxi, { key: "ArrowRight" });
    expect(document.activeElement).toBe(combustible);
    // It wraps around at the ends, and goes back up.
    fireEvent.keyDown(combustible, { key: "ArrowDown" });
    expect(document.activeElement).toBe(solo);
    fireEvent.keyDown(solo, { key: "ArrowUp" });
    expect(document.activeElement).toBe(combustible);
    fireEvent.keyDown(combustible, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(taxi);
    fireEvent.keyDown(taxi, { key: "End" });
    expect(document.activeElement).toBe(combustible);
    fireEvent.keyDown(combustible, { key: "Home" });
    expect(document.activeElement).toBe(solo);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("chooses the row with the focus on Enter", () => {
    const { onChoose } = renderStep(TRANSPORTE.id);
    const taxi = screen.getByRole("radio", { name: "Taxi y apps" });
    taxi.focus();
    fireEvent.keyDown(taxi, { key: "Enter" });
    expect(onChoose).toHaveBeenCalledWith("cat-Taxi y apps");
  });

  it("makes each row 60 px, with the radios hidden and the ring of focus on the row", () => {
    renderStep();
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.className).toContain("sr-only");
      const row = radio.nextElementSibling as HTMLElement;
      expect(row.className).toContain("min-h-15");
      expect(row.className).toContain("peer-focus-visible:outline-solid");
    }
  });
});

describe("CategorySelect", () => {
  function renderSelect(props: Partial<Parameters<typeof CategorySelect>[0]> = {}) {
    return render(<CategorySelect tree={TREE} value="" onChange={() => {}} {...props} />);
  }

  it("is a labelled select that starts on nothing", () => {
    renderSelect();
    const select = screen.getByLabelText("Categoría") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(select.value).toBe("");
    expect(within(select).getAllByRole("option")[0]?.textContent).toBe("Elige una");
  });

  it("groups by principal with the principal itself first, and 'Otras' for the rest", () => {
    renderSelect();
    const groups = Array.from(
      (screen.getByLabelText("Categoría") as HTMLSelectElement).querySelectorAll("optgroup"),
    ).map((group) => [
      group.label,
      Array.from(group.querySelectorAll("option")).map((option) => option.textContent),
    ]);
    expect(groups).toEqual([
      ["Comida", ["Comida", "Supermercado"]],
      ["Transporte", ["Transporte", "Taxi y apps", "Combustible"]],
      ["Otras", ["Ropa"]],
    ]);
  });

  it("takes the id of the category as the value of each option", () => {
    renderSelect({ value: TAXI.id });
    const select = screen.getByLabelText("Categoría") as HTMLSelectElement;
    expect(select.value).toBe("cat-Taxi y apps");
    expect(
      within(select)
        .getAllByRole("option", { name: "Combustible" })
        .map((option) => (option as HTMLOptionElement).value),
    ).toEqual(["cat-Combustible"]);
  });

  it("reports what is chosen", () => {
    const onChange = vi.fn();
    renderSelect({ onChange });
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "cat-Ropa" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("marks the error and links it", () => {
    renderSelect({ error: "Elige una categoría." });
    const select = screen.getByLabelText("Categoría");
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(select.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
  });

  it("offers no group at all for an empty tree, only the placeholder", () => {
    renderSelect({ tree: [] });
    const select = screen.getByLabelText("Categoría");
    expect(select.querySelectorAll("optgroup")).toHaveLength(0);
    expect(within(select).getAllByRole("option")).toHaveLength(1);
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilterSelect } from "./filter-select";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

function renderSelect(props: Partial<Parameters<typeof FilterSelect>[0]> = {}) {
  const onValueChange = vi.fn();
  render(
    <FilterSelect label="Cuenta" value="" onValueChange={onValueChange} {...props}>
      <option value="">Todas las cuentas</option>
      <option value="a1">Itaú</option>
    </FilterSelect>,
  );
  return {
    onValueChange,
    select: screen.getByRole("combobox", { name: "Cuenta" }) as HTMLSelectElement,
  };
}

describe("FilterSelect", () => {
  it("is a native select named by its label, with no visible label", () => {
    const { select } = renderSelect();
    expect(select.tagName).toBe("SELECT");
    expect(screen.queryByText("Cuenta", { selector: "label" })).toBeNull();
  });

  it("shows the value and tells the new one when it changes", () => {
    const { select, onValueChange } = renderSelect({ value: "a1" });
    expect(select.value).toBe("a1");
    fireEvent.change(select, { target: { value: "" } });
    expect(onValueChange).toHaveBeenCalledWith("");
  });

  it("is a pill of 42 px (44 and 16 px of text for a finger) with the border of a control", () => {
    const { select } = renderSelect();
    for (const cls of [
      "h-10.5",
      "pointer-coarse:h-11",
      "pointer-coarse:text-base",
      "rounded-full",
      "border-input",
      "appearance-none",
    ]) {
      expect(select.className).toContain(cls);
    }
  });

  it("cuts a long name with '…' instead of stretching the row, at 224 px", () => {
    const { select } = renderSelect();
    expect(select.className).toContain("truncate");
    expect(select.parentElement!.className).toContain("max-w-56");
    expect(select.parentElement!.className).toContain("min-w-0");
  });

  it("is off when asked, with the reason for a mouse", () => {
    const { select } = renderSelect({ disabled: true, title: "No se pudieron cargar tus cuentas" });
    expect(select.disabled).toBe(true);
    expect(select.title).toBe("No se pudieron cargar tus cuentas");
  });

  it("keeps the caret out of reach of the pointer and of speech", () => {
    renderSelect();
    const caret = screen.getByRole("combobox").parentElement!.querySelector("svg")!;
    expect(caret.getAttribute("aria-hidden")).toBe("true");
    expect(caret.getAttribute("class")).toContain("pointer-events-none");
  });
});

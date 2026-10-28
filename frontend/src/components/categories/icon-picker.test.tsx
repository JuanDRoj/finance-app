import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CATEGORY_ICON_NAMES } from "@/lib/core/i18n";
import { IconPicker } from "./icon-picker";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

describe("IconPicker", () => {
  it("is a group named 'Ícono' with the 66 icons as radios named in Spanish", () => {
    render(<IconPicker name="icon" size="page" />);
    const group = screen.getByRole("group", { name: "Ícono" });
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(66);
    expect(group.contains(radios[0]!)).toBe(true);
    expect(radios.map((radio) => radio.getAttribute("aria-label"))).toEqual(
      Object.values(CATEGORY_ICON_NAMES),
    );
    expect(screen.getByLabelText("Pesas")).toBeTruthy();
    // Every radio is of the same group, so the arrow keys move through all of them.
    for (const radio of radios) expect(radio.getAttribute("name")).toBe("icon");
  });

  it("starts with the default icon checked and nothing else", () => {
    render(<IconPicker name="icon" size="page" defaultValue="tag" />);
    const checked = screen
      .getAllByRole("radio")
      .filter((radio) => (radio as HTMLInputElement).checked);
    expect(checked.map((radio) => radio.getAttribute("aria-label"))).toEqual(["Etiqueta"]);
  });

  it("checks an icon when it is chosen, and reports the change with its key", () => {
    const onChange = vi.fn((event: { target: { value: string } }) => event.target.value);
    render(<IconPicker name="icon" size="page" defaultValue="tag" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Pesas"));
    expect((screen.getByLabelText("Pesas") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Etiqueta") as HTMLInputElement).checked).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.results[0]?.value).toBe("barbell");
  });

  it("follows its value when controlled", () => {
    const { rerender } = render(
      <IconPicker name="icon" size="page" value="car" onChange={() => {}} />,
    );
    expect((screen.getByLabelText("Auto") as HTMLInputElement).checked).toBe(true);
    rerender(<IconPicker name="icon" size="page" value="bus" onChange={() => {}} />);
    expect((screen.getByLabelText("Ómnibus") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Auto") as HTMLInputElement).checked).toBe(false);
  });

  it("has nothing checked for a key it does not know (an icon the backend added later)", () => {
    render(<IconPicker name="icon" size="page" defaultValue="a-future-icon" />);
    expect(
      screen.getAllByRole("radio").filter((radio) => (radio as HTMLInputElement).checked),
    ).toHaveLength(0);
  });

  it("hints each icon with its name on hover", () => {
    render(<IconPicker name="icon" size="page" />);
    const label = screen.getByLabelText("Pizza").closest("label");
    expect(label?.getAttribute("title")).toBe("Pizza");
  });

  it("draws the icons (decorative) and keeps the radio itself out of sight, not out of reach", () => {
    render(<IconPicker name="icon" size="page" />);
    const radio = screen.getByLabelText("Cubiertos");
    expect(radio.className).toContain("sr-only");
    const cell = radio.nextElementSibling as HTMLElement;
    expect(cell.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    // The ring is drawn on the cell when the hidden radio has keyboard focus.
    expect(cell.className).toContain("peer-focus-visible:outline-ring");
    expect(cell.className).toContain("peer-checked:bg-primary");
  });

  it("makes 44 px cells in 6 columns on a phone and 40 px cells in 8 columns in the panel", () => {
    const phone = render(<IconPicker name="icon" size="page" />);
    const grid = screen.getByRole("group").querySelector("div") as HTMLElement;
    expect(grid.className).toContain("grid-cols-6");
    expect(
      (screen.getAllByRole("radio")[0]!.nextElementSibling as HTMLElement).className,
    ).toContain("h-11");
    phone.unmount();
    render(<IconPicker name="icon" size="panel" />);
    const panelGrid = screen.getByRole("group").querySelector("div") as HTMLElement;
    expect(panelGrid.className).toContain("grid-cols-8");
    expect(
      (screen.getAllByRole("radio")[0]!.nextElementSibling as HTMLElement).className,
    ).toContain("h-10");
  });

  it("shows the error under the grid and ties it to the group", () => {
    render(<IconPicker name="icon" size="page" error="Elige un ícono." />);
    const group = screen.getByRole("group", { name: "Ícono" });
    expect(screen.getByText("Elige un ícono.")).toBeTruthy();
    const errorId = group.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(errorId)?.textContent).toContain("Elige un ícono.");
    expect(group.getAttribute("data-invalid")).toBe("true");
  });

  it("can be disabled as a whole", () => {
    render(<IconPicker name="icon" size="page" disabled />);
    expect((screen.getByRole("group") as HTMLFieldSetElement).disabled).toBe(true);
  });
});

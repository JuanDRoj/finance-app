import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BottomSheetDemo, DialogDemo, MoneyDemo, PanelDemo, PickersDemo } from "./base-demos";

// The catalog's demos are the first place the base pieces of the first use (KAN-91) work together:
// the panel with its fields, the sheet, the dialog. A smoke test that they open, name themselves,
// answer to the keyboard and give the focus back keeps the catalog honest.

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

describe("PanelDemo", () => {
  it("opens a panel named 'Nueva cuenta' with the focus on the name, and 'Cancelar' closes it", async () => {
    render(<PanelDemo />);
    const trigger = screen.getByRole("button", { name: "Abrir el panel lateral" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "Nueva cuenta" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Nombre")));
    expect(dialog.querySelector("[data-slot='sheet-body']")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("asks for the debt and the two days only when the type is a card", async () => {
    render(<PanelDemo />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir el panel lateral" }));
    await screen.findByRole("dialog");

    expect(screen.getByLabelText("Saldo actual")).toBeTruthy();
    expect(screen.queryByLabelText("Día de cierre")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Tarjeta" }));
    expect(screen.getByLabelText("Deuda actual").className).toContain("text-debt");
    expect((screen.getByLabelText("Día de cierre") as HTMLSelectElement).value).toBe("");
    expect(screen.getByLabelText("Día de vencimiento")).toBeTruthy();
  });

  it("shows the action as busy while it saves", async () => {
    render(<PanelDemo />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir el panel lateral" }));
    await screen.findByRole("dialog");
    const create = screen.getByRole("button", { name: "Crear cuenta" });
    fireEvent.click(create);
    expect(create.getAttribute("aria-busy")).toBe("true");
  });
});

describe("BottomSheetDemo", () => {
  it("is a sheet with the currency list, the action and a visible 'Cancelar' at the end", async () => {
    render(<BottomSheetDemo />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir la hoja inferior" }));

    const dialog = await screen.findByRole("dialog", { name: "Moneda de tu espacio" });
    expect(dialog.getAttribute("data-side")).toBe("bottom");
    expect(screen.getAllByRole("radio")).toHaveLength(6);
    expect(screen.getByRole("radio", { name: /Peso uruguayo/ })).toHaveProperty("checked", true);
    expect(screen.getByRole("button", { name: "Usar esta moneda" })).toBeTruthy();
    expect(dialog.lastElementChild?.textContent).toBe("Cancelar");

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("DialogDemo", () => {
  it("is a dialog named 'Moneda de tu espacio' and Escape closes it", async () => {
    render(<DialogDemo />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir el diálogo" }));

    const dialog = await screen.findByRole("dialog", { name: "Moneda de tu espacio" });
    fireEvent.click(screen.getByRole("radio", { name: /Euro/ }));
    expect(screen.getByRole("radio", { name: /Euro/ })).toHaveProperty("checked", true);

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("MoneyDemo and PickersDemo", () => {
  it("shows the field with the six currencies and two simulated exponents", () => {
    render(<MoneyDemo />);
    for (const code of ["UYU", "COP", "USD", "ARS", "BRL", "EUR", "CLP", "KWD"]) {
      expect(screen.getByLabelText(new RegExp(`· ${code}`))).toBeTruthy();
    }
    expect(screen.getByLabelText("Deuda actual (tono de deuda)").className).toContain("text-debt");
  });

  it("tells what the parser understands from what is typed", () => {
    render(<MoneyDemo />);
    const [pesos] = screen.getAllByLabelText("Prueba: escribe un monto") as HTMLInputElement[];
    expect(screen.getAllByText("Entiende: nada (vacío).").length).toBeGreaterThan(0);
    fireEvent.change(pesos as HTMLInputElement, { target: { value: "0,29" } });
    // The amount carries a no-break space after the symbol; Testing Library matches it as a space.
    expect(screen.getByText("Entiende: $ 0,29 (29 en unidad menor).")).toBeTruthy();
    fireEvent.change(pesos as HTMLInputElement, { target: { value: "1,505" } });
    expect(screen.getByText("No lo entiende: too_many_decimals.")).toBeTruthy();
  });

  it("renders the segmented controls and selects", () => {
    render(<PickersDemo />);
    expect(screen.getAllByRole("group").length).toBeGreaterThan(3);
    expect(screen.getByLabelText("Día de cierre (sin nada elegido)")).toHaveProperty("value", "");
  });
});

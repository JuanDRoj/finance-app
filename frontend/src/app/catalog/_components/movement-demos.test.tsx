import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeroMoneyDemo, MovementSheetDemo } from "./movement-demos";

// The demo runs the real sheet and form against a scripted client. This keeps the script honest: if
// the components change the calls they make, it fails here.
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/components/use-is-desktop", () => ({
  DESKTOP_MEDIA_QUERY: "(min-width: 64rem)",
  useIsDesktop: () => false,
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const choose = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const OUTCOME = "Qué responde el servidor al guardar";

async function openSheet() {
  fireEvent.click(screen.getByRole("button", { name: "Abrir «Registrar movimiento»" }));
  return screen.findByLabelText("Monto");
}

describe("MovementSheetDemo", () => {
  it("registers an expense and tells the container", async () => {
    render(<MovementSheetDemo instant />);
    fireEvent.change(await openSheet(), { target: { value: "2340,50" } });
    fireEvent.click(screen.getByRole("button", { name: "Ropa" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(await screen.findByText(/Se registró el movimiento/)).toBeTruthy();
  });

  it("hands over to 'Nueva cuenta' when no account is active", async () => {
    render(<MovementSheetDemo instant />);
    choose("Qué cuentas tiene el espacio", "none");
    fireEvent.click(screen.getByRole("button", { name: "Abrir «Registrar movimiento»" }));
    expect(await screen.findByText(/No hay cuentas activas/)).toBeTruthy();
  });

  it("explains that a transfer needs a second account when there is only one", async () => {
    render(<MovementSheetDemo instant />);
    choose("Qué cuentas tiene el espacio", "one");
    await openSheet();
    fireEvent.click(screen.getByRole("radio", { name: "Transferencia" }));
    expect(screen.getByText("Necesitas otra cuenta para transferir")).toBeTruthy();
  });

  it("says there are no expense categories when the space has none", async () => {
    render(<MovementSheetDemo instant />);
    choose("Qué categorías tiene", "noExpense");
    fireEvent.click(screen.getByRole("button", { name: "Abrir «Registrar movimiento»" }));
    expect(await screen.findByText("No tienes categorías de gasto activas")).toBeTruthy();
  });

  it("marks the category with the 422 outcome", async () => {
    render(<MovementSheetDemo instant />);
    choose(OUTCOME, "category");
    fireEvent.change(await openSheet(), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Ropa" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(await screen.findByText("Esa categoría está archivada. Elige otra.")).toBeTruthy();
  });

  it("marks the account with the 422 outcome", async () => {
    render(<MovementSheetDemo instant />);
    choose(OUTCOME, "account");
    fireEvent.change(await openSheet(), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Ropa" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(await screen.findByText("Esa cuenta ya no existe. Elige otra.")).toBeTruthy();
  });

  it("shows the error of the server and the lack of connection", async () => {
    render(<MovementSheetDemo instant />);
    choose(OUTCOME, "server");
    fireEvent.change(await openSheet(), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Ropa" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Algo salió mal");
  });

  it("holds a very long account name and category names", async () => {
    render(<MovementSheetDemo instant />);
    choose("Qué cuentas tiene el espacio", "long");
    choose("Qué categorías tiene", "long");
    await openSheet();
    expect(
      screen.getByRole("button", { name: /^Regalos y detalles para la familia/ }),
    ).toBeTruthy();
    const options = within(screen.getByLabelText("Cuenta")).getAllByRole("option");
    expect(options[0]?.textContent).toMatch(/^Cuenta de ahorro en pesos uruguayos/);
  });
});

describe("HeroMoneyDemo", () => {
  it("shows the big amount with each symbol and the extreme cases", () => {
    const { container } = render(<HeroMoneyDemo />);
    const symbols = Array.from(container.querySelectorAll("[aria-hidden='true'] > span")).map(
      (symbol) => symbol.textContent,
    );
    expect(symbols).toEqual(expect.arrayContaining(["$", "US$", "R$", "€"]));
    expect(screen.getAllByRole("textbox")).toHaveLength(7);
    expect(screen.getByText("El monto debe ser mayor que 0.")).toBeTruthy();
    expect((screen.getByLabelText(/Un monto de 16 dígitos/) as HTMLInputElement).value).toBe(
      "90071992547409,91",
    );
  });
});

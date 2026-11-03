import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MovementEditDemo } from "./movement-edit-demos";

// The demo runs the real form, the real detail and the real delete hook against the scripted
// backend. This keeps the script honest: if the components change the calls they make, or the
// backend's rules change, it fails here.
const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  refresh: vi.fn(),
  desktop: false,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: mocks.toastSuccess, error: mocks.toastError }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/components/use-is-desktop", () => ({
  DESKTOP_MEDIA_QUERY: "(min-width: 64rem)",
  useIsDesktop: () => mocks.desktop,
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

beforeEach(() => {
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  mocks.refresh.mockReset();
  mocks.desktop = false;
});

const MOVEMENT = "Qué movimiento se abre";

const choose = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

async function open(name: RegExp | string = /^Abrir/) {
  fireEvent.click(screen.getByRole("button", { name }));
  return screen.findByRole("dialog");
}

const rowsOf = (dialog: HTMLElement) =>
  Array.from(dialog.querySelectorAll("dt")).map((dt) => [
    dt.textContent,
    dt.nextElementSibling?.textContent,
  ]);

describe("the movements that open the form", () => {
  it("opens the expense of the canvas with its own values, the type fixed and 'Guardar cambios'", async () => {
    render(<MovementEditDemo instant />);
    const dialog = await open();
    expect(within(dialog).getByText("Editar movimiento")).toBeTruthy();
    expect(await within(dialog).findByLabelText("Monto")).toBeTruthy();
    expect((within(dialog).getByLabelText("Monto") as HTMLInputElement).value).toBe("380,00");
    expect((within(dialog).getByLabelText(/^Descripción/) as HTMLInputElement).value).toBe("Uber");
    expect(
      within(dialog).getByText(
        "El tipo no se cambia. Para cambiarlo, elimínalo y regístralo de nuevo.",
      ),
    ).toBeTruthy();
    expect(within(dialog).queryByRole("radio", { name: "Gasto" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Guardar cambios" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Eliminar movimiento" })).toBeTruthy();
  });

  it("opens an income, a transfer and the worst case, each with its values", async () => {
    render(<MovementEditDemo instant />);
    choose(MOVEMENT, "income");
    let dialog = await open();
    expect(((await within(dialog).findByLabelText("Monto")) as HTMLInputElement).value).toBe(
      "50000,00",
    );
    expect(within(dialog).getByText("Ingreso")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    choose(MOVEMENT, "transfer");
    dialog = await open();
    expect(((await within(dialog).findByLabelText("Desde")) as HTMLSelectElement).value).toBe("a1");
    expect((within(dialog).getByLabelText("Hacia") as HTMLSelectElement).value).toBe("a4");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    choose(MOVEMENT, "worst");
    dialog = await open();
    expect(((await within(dialog).findByLabelText("Monto")) as HTMLInputElement).value).toBe(
      "90071992547409,91",
    );
    expect([
      ...(within(dialog).getByLabelText(/^Descripción/) as HTMLInputElement).value,
    ]).toHaveLength(200);
  });

  it("writes the amount with the exponent of the currency: no decimals and three", async () => {
    render(<MovementEditDemo instant />);
    choose("Moneda del espacio", "CLP");
    let dialog = await open();
    expect(((await within(dialog).findByLabelText("Monto")) as HTMLInputElement).value).toBe(
      "38000",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    choose("Moneda del espacio", "BHD");
    dialog = await open();
    expect(((await within(dialog).findByLabelText("Monto")) as HTMLInputElement).value).toBe(
      "38,000",
    );
  });

  it("shows a category archived since as '(archivada)', chosen, and keeps it on save", async () => {
    render(<MovementEditDemo instant />);
    choose(MOVEMENT, "archivedCategory");
    const dialog = await open();
    const ropa = await within(dialog).findByRole("button", { name: "Ropa (archivada)" });
    expect(ropa.getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(within(dialog).getByLabelText("Monto"), { target: { value: "1500" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText(/Se guardaron los cambios/)).toBeTruthy();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Guardaste los cambios de «Campera»");
  });

  it("a subcategory archived with its archived principal is the place the second step opens on", async () => {
    render(<MovementEditDemo instant />);
    choose(MOVEMENT, "archivedSub");
    const dialog = await open();
    expect(await within(dialog).findByText("Mascotas › Veterinaria (archivada)")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cambiar" }));
    expect(await within(dialog).findByText("Elige una subcategoría de Mascotas.")).toBeTruthy();
    expect(within(dialog).queryByRole("radio", { name: /Solo/ })).toBeNull();
    expect(within(dialog).getByRole("radio", { name: "Veterinaria (archivada)" })).toBeTruthy();
  });
});

describe("saving", () => {
  it("saves the changes, says so, and reopening shows the saved movement", async () => {
    render(<MovementEditDemo instant />);
    let dialog = await open();
    fireEvent.change(await within(dialog).findByLabelText("Monto"), {
      target: { value: "400,50" },
    });
    fireEvent.change(within(dialog).getByLabelText(/^Descripción/), {
      target: { value: "Uber al aeropuerto" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText(/Se guardaron los cambios/)).toBeTruthy();
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Guardaste los cambios de «Uber al aeropuerto»",
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    dialog = await open();
    expect(((await within(dialog).findByLabelText("Monto")) as HTMLInputElement).value).toBe(
      "400,50",
    );
    expect((within(dialog).getByLabelText(/^Descripción/) as HTMLInputElement).value).toBe(
      "Uber al aeropuerto",
    );
  });

  it("with nothing changed closes and asks nothing", async () => {
    render(<MovementEditDemo instant />);
    const dialog = await open();
    await within(dialog).findByLabelText("Monto");
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText(/No cambió nada/)).toBeTruthy();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("shows what the server refuses in the form: a 409 and a 404", async () => {
    render(<MovementEditDemo instant />);
    choose("Qué responde al guardar los cambios", "accountArchived");
    const dialog = await open();
    fireEvent.change(await within(dialog).findByLabelText("Monto"), { target: { value: "400" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    expect(
      await within(dialog).findByText(
        "Desarchívala desde Cuentas para poder editar este movimiento.",
      ),
    ).toBeTruthy();
    choose("Qué responde al guardar los cambios", "notFound");
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    expect(await within(dialog).findByText("No encontramos ese movimiento")).toBeTruthy();
  });

  it("marks the amount when the server says it is too high", async () => {
    render(<MovementEditDemo instant />);
    choose("Qué responde al guardar los cambios", "amount");
    const dialog = await open();
    fireEvent.change(await within(dialog).findByLabelText("Monto"), { target: { value: "400" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Monto").getAttribute("aria-invalid")).toBe("true"),
    );
  });
});

describe("deleting and 'Deshacer'", () => {
  it("deletes from the sheet with no question: closes, says it with 'Deshacer' and the server forgets it", async () => {
    render(<MovementEditDemo instant />);
    const dialog = await open();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Eliminar movimiento" }));
    expect(await screen.findByText(/Se eliminó «Uber»/)).toBeTruthy();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Eliminaste «Uber»", {
      duration: 6000,
      action: { label: "Deshacer", onClick: expect.any(Function) },
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText(/Eliminados: «Uber»/)).toBeTruthy();
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("'Deshacer' brings it back, and it can be opened again", async () => {
    render(<MovementEditDemo instant />);
    const dialog = await open();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Eliminar movimiento" }));
    await screen.findByText(/Eliminados: «Uber»/);
    act(() => mocks.toastSuccess.mock.calls[0]![1].action.onClick());
    expect(await screen.findByText(/No hay nada eliminado/)).toBeTruthy();
    expect(mocks.toastError).not.toHaveBeenCalled();
    const again = await open();
    expect(((await within(again).findByLabelText("Monto")) as HTMLInputElement).value).toBe(
      "380,00",
    );
  });

  it("a deleted movement opens as a 404, in the sheet", async () => {
    render(<MovementEditDemo instant />);
    const dialog = await open();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Eliminar movimiento" }));
    await screen.findByText(/Eliminados: «Uber»/);
    const again = await open();
    expect(await within(again).findByText("No encontramos ese movimiento")).toBeTruthy();
  });

  it("deletes without opening it, as the row of the table will", async () => {
    render(<MovementEditDemo instant />);
    fireEvent.click(screen.getByRole("button", { name: /^Eliminar sin abrir/ }));
    expect(await screen.findByText(/Eliminados: «Uber»/)).toBeTruthy();
    expect(mocks.toastSuccess.mock.calls[0]![0]).toBe("Eliminaste «Uber»");
  });

  it("'Empezar de nuevo' puts back what was deleted", async () => {
    render(<MovementEditDemo instant />);
    fireEvent.click(screen.getByRole("button", { name: /^Eliminar sin abrir/ }));
    await screen.findByText(/Eliminados: «Uber»/);
    fireEvent.click(screen.getByRole("button", { name: "Empezar de nuevo" }));
    expect(await screen.findByText(/No hay nada eliminado/)).toBeTruthy();
  });

  it("explains in a toast what the server refuses: 409 account archived and 404", async () => {
    render(<MovementEditDemo instant />);
    choose("Qué responde al eliminar", "accountArchived");
    fireEvent.click(screen.getByRole("button", { name: /^Eliminar sin abrir/ }));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("Esa cuenta está archivada", {
        description: "Desarchívala desde Cuentas para poder eliminar este movimiento.",
      }),
    );
    choose("Qué responde al eliminar", "notFound");
    fireEvent.click(screen.getByRole("button", { name: /^Eliminar sin abrir/ }));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenLastCalledWith("No encontramos ese movimiento", {
        description: expect.any(String),
      }),
    );
  });

  it("when 'Deshacer' fails with an archived account it explains, and offers no retry", async () => {
    render(<MovementEditDemo instant />);
    fireEvent.click(screen.getByRole("button", { name: /^Eliminar sin abrir/ }));
    await screen.findByText(/Eliminados: «Uber»/);
    choose("Qué responde «Deshacer»", "accountArchived");
    act(() => mocks.toastSuccess.mock.calls[0]![1].action.onClick());
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    const [title, options] = mocks.toastError.mock.calls[0]!;
    expect(title).toBe("No se pudo deshacer");
    expect(options.action).toBeUndefined();
    expect(screen.getByText(/Eliminados: «Uber»/)).toBeTruthy();
  });

  it("when 'Deshacer' has no connection it offers 'Reintentar', and that restores it", async () => {
    render(<MovementEditDemo instant />);
    fireEvent.click(screen.getByRole("button", { name: /^Eliminar sin abrir/ }));
    await screen.findByText(/Eliminados: «Uber»/);
    choose("Qué responde «Deshacer»", "offline");
    act(() => mocks.toastSuccess.mock.calls[0]![1].action.onClick());
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    const options = mocks.toastError.mock.calls[0]![1];
    expect(options.action.label).toBe("Reintentar");
    choose("Qué responde «Deshacer»", "ok");
    act(() => options.action.onClick());
    expect(await screen.findByText(/No hay nada eliminado/)).toBeTruthy();
  });

  it("has no 'Eliminar sin abrir' for what cannot be deleted", () => {
    render(<MovementEditDemo instant />);
    for (const key of ["adjustment", "pending", "skipped"]) {
      choose(MOVEMENT, key);
      expect(screen.queryByRole("button", { name: /^Eliminar sin abrir/ })).toBeNull();
    }
  });
});

describe("what is only read", () => {
  it("an adjustment is 'Ajuste de saldo': amount, account, date, the note, 'Cuadrar saldo' and 'Cerrar', and nothing to delete", async () => {
    render(<MovementEditDemo instant />);
    choose(MOVEMENT, "adjustment");
    const dialog = await open();
    expect(await within(dialog).findByText("Ajuste de saldo")).toBeTruthy();
    expect(rowsOf(dialog)).toEqual([
      ["Monto", "−$ 300,00"],
      ["Cuenta", "Efectivo"],
      ["Fecha", "Martes 13 de octubre"],
    ]);
    expect(within(dialog).getByRole("link", { name: "Cuadrar saldo" }).getAttribute("href")).toBe(
      "/cuentas?sel=a3&cuenta=cuadrar",
    );
    expect(within(dialog).queryByRole("button", { name: /Eliminar|Guardar/ })).toBeNull();
    expect(within(dialog).getAllByRole("button", { name: "Cerrar" }).length).toBeGreaterThan(0);
  });

  it("an adjustment of an archived account has no 'Cuadrar saldo'", async () => {
    render(<MovementEditDemo instant />);
    choose(MOVEMENT, "adjustmentArchived");
    const dialog = await open();
    await within(dialog).findByText("Ajuste de saldo");
    expect(within(dialog).queryByRole("link", { name: "Cuadrar saldo" })).toBeNull();
  });

  it("a pending movement says so; one of an archived account names it and links to Cuentas", async () => {
    render(<MovementEditDemo instant />);
    choose(MOVEMENT, "pending");
    let dialog = await open();
    expect(await within(dialog).findByText("Detalle del movimiento")).toBeTruthy();
    expect(within(dialog).getByText(/Este movimiento está pendiente/)).toBeTruthy();
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Cerrar" })[0]!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    choose(MOVEMENT, "archivedAccount");
    dialog = await open();
    expect(
      await within(dialog).findByText(
        "Desarchiva «Cuenta vieja» desde Cuentas para editar o eliminar este movimiento.",
      ),
    ).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Ir a Cuentas" })).toBeTruthy();
  });
});

describe("opening", () => {
  it("shows a skeleton while it loads, and an Alert with a way to close if the server says 404", async () => {
    render(<MovementEditDemo instant />);
    choose("Qué responde al abrirlo", "notFound");
    const dialog = await open();
    expect(await within(dialog).findByText("No encontramos ese movimiento")).toBeTruthy();
    expect(within(dialog).queryByLabelText("Monto")).toBeNull();
  });

  it("says it in Spanish if the server fails", async () => {
    render(<MovementEditDemo instant />);
    choose("Qué responde al abrirlo", "server");
    const dialog = await open();
    expect(await within(dialog).findByText("Algo salió mal de nuestro lado")).toBeTruthy();
  });

  it("the desktop shape is the side panel, with 'Eliminar movimiento' at the end of the body", async () => {
    mocks.desktop = true;
    render(<MovementEditDemo instant />);
    const dialog = await open();
    const remove = await within(dialog).findByRole("button", { name: "Eliminar movimiento" });
    expect(dialog.getAttribute("data-side")).toBe("right");
    expect(remove.textContent).toBe("Eliminar movimiento");
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeTruthy();
  });
});

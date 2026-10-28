import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CategoryFormsDemo } from "./category-demos";

// The demo runs the real forms, the picker and the panel against a scripted client. This keeps the
// script honest: if the components change the calls they make, it fails here.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const choose = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** The two forms are in the page at once: each field exists twice, once in each frame. */
function frame(title: string) {
  return within(screen.getByText(title).parentElement as HTMLElement);
}

describe("CategoryFormsDemo", () => {
  it("shows both forms as pages, each with its fixed bar", () => {
    render(<CategoryFormsDemo instant />);
    const create = frame("Nueva categoría (página)");
    expect(create.getByRole("button", { name: "Crear categoría" })).toBeTruthy();
    const edit = frame("Editar categoría (página)");
    expect(edit.getByRole("button", { name: "Guardar cambios" })).toBeTruthy();
    expect(edit.getByText("Categoría de gasto · principal")).toBeTruthy();
    expect(document.querySelectorAll("[data-slot='category-form-footer']")).toHaveLength(2);
  });

  it("creates a category and tells the container", async () => {
    render(<CategoryFormsDemo instant />);
    const create = frame("Nueva categoría (página)");
    fireEvent.change(create.getByLabelText("Nombre"), { target: { value: "Gimnasio" } });
    fireEvent.click(create.getByRole("button", { name: "Crear categoría" }));
    expect(await screen.findByText(/Se guardó «Gimnasio»/)).toBeTruthy();
  });

  it("renames the category that is being edited", async () => {
    render(<CategoryFormsDemo instant />);
    const edit = frame("Editar categoría (página)");
    expect((edit.getByLabelText("Nombre") as HTMLInputElement).value).toBe("Transporte");
    fireEvent.change(edit.getByLabelText("Nombre"), { target: { value: "Movilidad" } });
    fireEvent.click(edit.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("Se guardaron los cambios.")).toBeTruthy();
  });

  it("archives the category that is being edited", async () => {
    render(<CategoryFormsDemo instant />);
    fireEvent.click(
      frame("Editar categoría (página)").getByRole("button", { name: /Archivar categoría/ }),
    );
    expect(await screen.findByText(/La categoría se archivó/)).toBeTruthy();
  });

  it("offers to unarchive the archived category a repeated name clashes with", async () => {
    render(<CategoryFormsDemo instant />);
    choose("Qué responde el servidor al crear, guardar o archivar", "taken");
    const create = frame("Nueva categoría (página)");
    fireEvent.change(create.getByLabelText("Nombre"), { target: { value: "Mascotas" } });
    fireEvent.click(create.getByRole("button", { name: "Crear categoría" }));
    const button = await create.findByRole("button", { name: "Desarchivar «Mascotas»" });
    fireEvent.click(button);
    expect(await screen.findByText(/Se guardó «Mascotas»/)).toBeTruthy();
  });

  it("only says the name is in use when the clash is active", async () => {
    render(<CategoryFormsDemo instant />);
    choose("Qué responde el servidor al crear, guardar o archivar", "taken");
    const create = frame("Nueva categoría (página)");
    fireEvent.change(create.getByLabelText("Nombre"), { target: { value: "Comida" } });
    fireEvent.click(create.getByRole("button", { name: "Crear categoría" }));
    expect(await create.findByText("Ya tienes una categoría con ese nombre.")).toBeTruthy();
    expect(create.queryByRole("button", { name: /Desarchivar/ })).toBeNull();
  });

  it("marks the name with the 422 outcome and 'Dentro de' with the archived principal", async () => {
    render(<CategoryFormsDemo instant />);
    choose("Qué responde el servidor al crear, guardar o archivar", "fields");
    const create = frame("Nueva categoría (página)");
    fireEvent.change(create.getByLabelText("Nombre"), { target: { value: "Otro" } });
    fireEvent.click(create.getByRole("button", { name: "Crear categoría" }));
    expect(await create.findByText("Es demasiado largo.")).toBeTruthy();

    choose("Qué responde el servidor al crear, guardar o archivar", "parent");
    fireEvent.change(create.getByLabelText("Nombre"), { target: { value: "Otro" } });
    fireEvent.change(create.getByLabelText("Dentro de"), {
      target: { value: "00000000-0000-4000-8000-000000000001" },
    });
    fireEvent.click(create.getByRole("button", { name: "Crear categoría" }));
    expect(
      await create.findByText("Esa categoría principal está archivada. Elige otra."),
    ).toBeTruthy();
  });

  it("switches to the worst case: names of 80 characters, thirty principals and twelve subcategories", async () => {
    render(<CategoryFormsDemo instant />);
    choose("Qué datos", "worst");
    const create = frame("Nueva categoría (página)");
    // 8 principals of the data plus the 30 filler ones, plus "Ninguna".
    await waitFor(() =>
      expect(
        within(create.getByLabelText("Dentro de")).getAllByRole("option").length,
      ).toBeGreaterThan(30),
    );
    choose("Qué categoría se edita", "1");
    const edit = frame("Editar categoría (página)");
    const name = edit.getByLabelText("Nombre") as HTMLInputElement;
    expect([...name.value]).toHaveLength(80);
    expect(edit.getByText(/También se archivan sus 12 subcategorías/)).toBeTruthy();
  });

  it("edits a category with an icon this frontend does not know, and an unbreakable name", async () => {
    render(<CategoryFormsDemo instant />);
    choose("Qué datos", "worst");
    choose("Qué categoría se edita", "40");
    const edit = frame("Editar categoría (página)");
    expect((edit.getByLabelText("Nombre") as HTMLInputElement).value).toBe("Con un ícono nuevo");
    fireEvent.change(edit.getByLabelText("Nombre"), { target: { value: "Con un ícono nuevo 2" } });
    fireEvent.click(edit.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("Se guardaron los cambios.")).toBeTruthy();
  });

  // One panel per test: each renders the whole demo (two forms with 66 icons each, plus the panel),
  // and the three in one test took long enough to hit the 5 s limit on a loaded machine.
  it("opens the side panel 'Nueva categoría' and closes it with 'Cancelar'", async () => {
    render(<CategoryFormsDemo instant />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir el panel «Nueva categoría»" }));
    const created = await screen.findByRole("dialog", { name: "Nueva categoría" });
    expect(await within(created).findByLabelText("Nombre")).toBeTruthy();
    fireEvent.click(within(created).getByRole("button", { name: "Cancelar" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Nueva categoría" })).toBeNull(),
    );
  });

  it("opens the side panel 'Nueva categoría' from 'Agregar subcategoría' with the principal chosen", async () => {
    render(<CategoryFormsDemo instant />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Abrir el panel «Nueva categoría» desde «Agregar subcategoría»",
      }),
    );
    const sub = await screen.findByRole("dialog", { name: "Nueva categoría" });
    const select = (await within(sub).findByLabelText("Dentro de")) as HTMLSelectElement;
    expect(select.value).toBe("00000000-0000-4000-8000-000000000001");
    fireEvent.click(within(sub).getByRole("button", { name: "Cancelar" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Nueva categoría" })).toBeNull(),
    );
  });

  it("opens the side panel 'Editar categoría' with the category that is being edited", async () => {
    render(<CategoryFormsDemo instant />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir el panel «Editar categoría»" }));
    const edit = await screen.findByRole("dialog", { name: "Editar categoría" });
    expect(((await within(edit).findByLabelText("Nombre")) as HTMLInputElement).value).toBe(
      "Transporte",
    );
  });
});

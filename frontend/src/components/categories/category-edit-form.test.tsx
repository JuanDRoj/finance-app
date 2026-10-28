import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { categoriesQueryKey, type CategoryRead } from "@/lib/core/data/categories";
import { transactionsQueryKey } from "@/lib/core/data/transactions";
import { CategoryEditForm } from "./category-edit-form";

// The edges are mocked: the typed browser client, the toast and the router. What is under test is
// the form: what it shows, what it sends (only what changed), how a failure comes back and how the
// archive hangs from it.
const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  post: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@/lib/api/browser", () => ({ browserApi: { PATCH: mocks.patch, POST: mocks.post } }));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  onlineManager.setOnline(true);
});

const SPACE = { id: "space-1" };

function category(
  overrides: Partial<CategoryRead> & Pick<CategoryRead, "id" | "name">,
): CategoryRead {
  return { kind: "expense", icon: "tag", parent_id: null, archived_at: null, ...overrides };
}

const TRANSPORTE = category({ id: "cat-transporte", name: "Transporte", icon: "car" });
const COMBUSTIBLE = category({
  id: "cat-comb",
  name: "Combustible",
  icon: "gas-pump",
  parent_id: TRANSPORTE.id,
});
const TAXI = category({
  id: "cat-taxi",
  name: "Taxi y apps",
  icon: "taxi",
  parent_id: TRANSPORTE.id,
});
const COMIDA = category({ id: "cat-comida", name: "Comida", icon: "fork-knife" });
const MASCOTAS = category({
  id: "cat-mascotas",
  name: "Mascotas",
  icon: "paw-print",
  archived_at: "2026-10-18T15:00:00Z",
});
const TRABAJO = category({ id: "cat-trabajo", name: "Trabajo", kind: "income", icon: "briefcase" });
const ROPA = category({ id: "cat-ropa", name: "Ropa", icon: "t-shirt" });
const CATEGORIES = [TRANSPORTE, COMBUSTIBLE, TAXI, COMIDA, MASCOTAS, TRABAJO, ROPA];

function ok(data: unknown, status = 200) {
  return { data, response: new Response(null, { status }) };
}

function failure(status: number, body?: unknown) {
  return { error: body, response: new Response(null, { status }) };
}

// The first render in jsdom pays for warming up the modules (react-hook-form, zod, Base UI, the 66 icons),
// not for what the tests check: it is done here so that no test carries that cost. A hook does not count
// against the limit of a test, and the first test of the file is the one that hit it under load.
beforeAll(() => {
  renderForm();
  cleanup();
});

beforeEach(() => {
  mocks.patch
    .mockReset()
    .mockImplementation(async (_path, init) => ok({ ...TRANSPORTE, ...init.body }));
  mocks.post
    .mockReset()
    .mockResolvedValue(ok({ ...TRANSPORTE, archived_at: "2026-10-28T12:00:00Z" }));
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  mocks.refresh.mockReset();
  mocks.replace.mockReset();
  vi.stubGlobal("location", { ...window.location, replace: mocks.replace });
});

function renderForm(props: Partial<Parameters<typeof CategoryEditForm>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const onDone = vi.fn();
  const onArchived = vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <CategoryEditForm
        category={TRANSPORTE}
        categories={CATEGORIES}
        space={SPACE}
        variant="page"
        onDone={onDone}
        onArchived={onArchived}
        onCancel={onCancel}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...view, onDone, onArchived, onCancel, invalidate, queryClient };
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function save() {
  fireEvent.click(screen.getByRole("button", { hidden: true, name: "Guardar cambios" }));
}

function sentBody() {
  expect(mocks.patch).toHaveBeenCalledTimes(1);
  return mocks.patch.mock.calls[0]?.[1]?.body;
}

describe("what the form shows", () => {
  it("says where the category sits and that its type and principal are not changed", () => {
    renderForm();
    expect(screen.getByText("Categoría de gasto · principal")).toBeTruthy();
    expect(
      screen.getByText("El tipo y la categoría principal no se cambian después de crearla."),
    ).toBeTruthy();
  });

  it("says 'de ingreso' for an income and names the principal of a subcategory", () => {
    const income = renderForm({ category: TRABAJO });
    expect(screen.getByText("Categoría de ingreso · principal")).toBeTruthy();
    income.unmount();
    renderForm({ category: TAXI });
    expect(screen.getByText("Subcategoría de Transporte")).toBeTruthy();
  });

  it("starts with the category's name and icon, and has no type nor principal to change", () => {
    renderForm();
    expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe("Transporte");
    expect((screen.getByLabelText("Auto") as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByRole("radio", { hidden: true })).toHaveLength(66);
    expect(screen.queryByRole("group", { hidden: true, name: "Tipo" })).toBeNull();
    expect(screen.queryByLabelText("Dentro de")).toBeNull();
  });

  it("has the group 'Más acciones' with 'Archivar categoría' and counts the real subcategories in its help", () => {
    renderForm();
    const group = screen.getByRole("region", { name: "Más acciones" });
    expect(within(group).getByText("Archivar categoría")).toBeTruthy();
    expect(
      within(group).getByText(
        "También se archivan sus 2 subcategorías. Los movimientos que ya la usan la conservan.",
      ),
    ).toBeTruthy();
  });

  it("says one subcategory in the singular, and none for a principal without them or a subcategory", () => {
    const one = renderForm({
      category: TRANSPORTE,
      categories: [TRANSPORTE, COMBUSTIBLE],
    });
    expect(screen.getByText(/También se archiva su subcategoría\./)).toBeTruthy();
    one.unmount();
    const none = renderForm({ category: ROPA });
    expect(screen.getByText("Los movimientos que ya la usan la conservan.")).toBeTruthy();
    none.unmount();
    renderForm({ category: TAXI });
    expect(screen.getByText("Los movimientos que ya la usan la conservan.")).toBeTruthy();
    expect(screen.queryByText(/También se archiv/)).toBeNull();
  });

  it("is a page with 'Guardar cambios' in a fixed bar, or a panel with 'Cancelar · Guardar cambios'", () => {
    const page = renderForm({ variant: "page" });
    const bar = document.querySelector("[data-slot='category-form-footer']") as HTMLElement;
    expect(bar.className).toContain("fixed");
    expect(within(bar).getByRole("button", { hidden: true, name: "Guardar cambios" })).toBeTruthy();
    page.unmount();
    const panel = renderForm({ variant: "panel" });
    expect(document.querySelector("[data-slot='category-form-footer']")).toBeNull();
    fireEvent.click(screen.getByRole("button", { hidden: true, name: "Cancelar" }));
    expect(panel.onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("what it sends", () => {
  it("renames: only the name, and tells the container", async () => {
    const { onDone, invalidate } = renderForm();
    type("Nombre", "  Movilidad ");
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    expect(mocks.patch.mock.calls[0]?.[0]).toBe("/spaces/{space_id}/categories/{category_id}");
    expect(mocks.patch.mock.calls[0]?.[1]?.params.path).toEqual({
      space_id: "space-1",
      category_id: TRANSPORTE.id,
    });
    expect(sentBody()).toEqual({ name: "Movilidad" });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Guardaste «Movilidad»");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["spaces", "space-1", "categories"] });
  });

  it("changes the icon: only the icon", async () => {
    const { onDone } = renderForm();
    fireEvent.click(screen.getByLabelText("Ómnibus"));
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    expect(sentBody()).toEqual({ icon: "bus" });
  });

  it("changes both when both changed", async () => {
    const { onDone } = renderForm();
    type("Nombre", "Movilidad");
    fireEvent.click(screen.getByLabelText("Moto"));
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    expect(sentBody()).toEqual({ name: "Movilidad", icon: "motorcycle" });
  });

  it("also marks the movements as old: their rows show the name and the icon of the category", async () => {
    const { queryClient, onDone } = renderForm();
    queryClient.setQueryData(transactionsQueryKey("space-1"), { items: [] });
    queryClient.setQueryData(categoriesQueryKey("space-1"), [TRANSPORTE]);
    type("Nombre", "Movilidad");
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(queryClient.getQueryState(transactionsQueryKey("space-1"))?.isInvalidated).toBe(true);
    // The sheet of "Registrar movimiento" asks for the list without the archived ones.
    expect(queryClient.getQueryState(categoriesQueryKey("space-1"))?.isInvalidated).toBe(true);
  });

  it("sends nothing when nothing changed, and closes", async () => {
    const { onDone } = renderForm();
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(false));
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("counts the spaces at the ends of the name as no change", async () => {
    const { onDone } = renderForm();
    type("Nombre", "  Transporte  ");
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(false));
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it("counts a change of case as a rename", async () => {
    const { onDone } = renderForm();
    type("Nombre", "TRANSPORTE");
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    expect(sentBody()).toEqual({ name: "TRANSPORTE" });
  });

  it("lets a category with an icon this frontend does not know be renamed, without sending the icon", async () => {
    const future = { ...TRANSPORTE, icon: "a-future-icon" } as unknown as CategoryRead;
    const { onDone } = renderForm({ category: future });
    type("Nombre", "Movilidad");
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    expect(sentBody()).toEqual({ name: "Movilidad" });
  });
});

describe("what it checks before sending", () => {
  it("asks for a name, and refuses 81 characters", async () => {
    renderForm();
    type("Nombre", " ");
    save();
    expect(await screen.findByText("Escribe un nombre.")).toBeTruthy();
    type("Nombre", "a".repeat(81));
    save();
    expect(await screen.findByText("Usa como máximo 80 caracteres.")).toBeTruthy();
    expect(mocks.patch).not.toHaveBeenCalled();
  });
});

describe("a repeated name (409 category_name_taken)", () => {
  const TAKEN = { code: "category_name_taken", detail: "A category with this name already exists" };

  it("says the name is in use when the sibling is active, with no offer to unarchive", async () => {
    mocks.patch.mockResolvedValue(failure(409, TAKEN));
    renderForm();
    type("Nombre", "comida");
    save();
    expect(await screen.findByText("Ya tienes una categoría con ese nombre.")).toBeTruthy();
    expect(screen.getByLabelText("Nombre").getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByRole("button", { hidden: true, name: /Desarchivar/ })).toBeNull();
  });

  it("says the sibling is archived, but offers no 'Desarchivar' (it would not free the name)", async () => {
    mocks.patch.mockResolvedValue(failure(409, TAKEN));
    renderForm();
    type("Nombre", "Mascotas");
    save();
    expect(
      await screen.findByText("Ya tienes una categoría archivada con ese nombre."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { hidden: true, name: /Desarchivar/ })).toBeNull();
  });

  it("looks among the siblings of a subcategory only, and leaves itself out", async () => {
    mocks.patch.mockResolvedValue(failure(409, TAKEN));
    // Comida is a principal; Combustible is a sibling of Taxi y apps.
    renderForm({ category: TAXI });
    type("Nombre", "Comida");
    save();
    // No sibling called Comida under Transporte: the plain message.
    expect(await screen.findByText("Ya tienes una categoría con ese nombre.")).toBeTruthy();
  });

  it("lets the person fix the name and save again", async () => {
    mocks.patch.mockResolvedValueOnce(failure(409, TAKEN));
    const { onDone } = renderForm();
    type("Nombre", "Comida");
    save();
    await screen.findByText("Ya tienes una categoría con ese nombre.");
    type("Nombre", "Movilidad");
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    expect(mocks.patch).toHaveBeenCalledTimes(2);
  });
});

describe("other failures", () => {
  it("marks the name with a 422", async () => {
    mocks.patch.mockResolvedValue(
      failure(422, {
        detail: [{ type: "string_too_long", loc: ["body", "name"], msg: "Too long" }],
      }),
    );
    renderForm();
    type("Nombre", "Movilidad");
    save();
    expect(await screen.findByText("Es demasiado largo.")).toBeTruthy();
  });

  it("shows a category that is gone (404) in an Alert, in Spanish", async () => {
    mocks.patch.mockResolvedValue(
      failure(404, { code: "category_not_found", detail: "Category not found" }),
    );
    renderForm();
    type("Nombre", "Movilidad");
    save();
    expect(await screen.findByText("No encontramos esa categoría")).toBeTruthy();
    expect(screen.queryByText("category_not_found")).toBeNull();
  });

  it("goes to /login on a 401", async () => {
    mocks.patch.mockResolvedValue(failure(401, { code: "invalid_session", detail: "x" }));
    renderForm();
    type("Nombre", "Movilidad");
    save();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
  });

  it("says there is no connection while the request waits", async () => {
    onlineManager.setOnline(false);
    renderForm();
    type("Nombre", "Movilidad");
    save();
    expect(await screen.findByText("No pudimos conectar")).toBeTruthy();
  });

  it("sends one request for a double tap", async () => {
    let resolve: (value: unknown) => void = () => {};
    mocks.patch.mockReturnValue(new Promise((done) => (resolve = done)));
    const { onDone } = renderForm();
    type("Nombre", "Movilidad");
    const button = screen.getByRole("button", { hidden: true, name: "Guardar cambios" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledTimes(1));
    resolve(ok({ ...TRANSPORTE, name: "Movilidad" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(mocks.patch).toHaveBeenCalledTimes(1);
  });
});

describe("Archivar categoría", () => {
  it("archives with no confirmation, with 'Deshacer' in the toast, and tells the container", async () => {
    const { onArchived, invalidate } = renderForm();
    fireEvent.click(screen.getByRole("button", { hidden: true, name: /Archivar categoría/ }));
    await waitFor(() => expect(onArchived).toHaveBeenCalledTimes(1));
    expect(mocks.post.mock.calls[0]?.[0]).toBe(
      "/spaces/{space_id}/categories/{category_id}/archive",
    );
    expect(mocks.post.mock.calls[0]?.[1]?.params.path).toEqual({
      space_id: "space-1",
      category_id: TRANSPORTE.id,
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Archivaste «Transporte»",
      expect.objectContaining({ action: expect.objectContaining({ label: "Deshacer" }) }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["spaces", "space-1", "categories"] });
  });

  it("shows the error when it fails, and does not tell the container", async () => {
    mocks.post.mockResolvedValue(
      failure(404, { code: "category_not_found", detail: "Category not found" }),
    );
    const { onArchived } = renderForm();
    fireEvent.click(screen.getByRole("button", { hidden: true, name: /Archivar categoría/ }));
    expect(await screen.findByText("No encontramos esa categoría")).toBeTruthy();
    expect(onArchived).not.toHaveBeenCalled();
  });

  it("does not let the save and the archive run together", async () => {
    let resolve: (value: unknown) => void = () => {};
    mocks.patch.mockReturnValue(new Promise((done) => (resolve = done)));
    renderForm();
    type("Nombre", "Movilidad");
    save();
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledTimes(1));
    expect(
      (
        screen.getByRole("button", {
          hidden: true,
          name: /Archivar categoría/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    resolve(ok({ ...TRANSPORTE, name: "Movilidad" }));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(mocks.post).not.toHaveBeenCalled();
  });
});

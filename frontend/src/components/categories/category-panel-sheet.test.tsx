import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { CategoryRead } from "@/lib/core/data/categories";
import { CategoryPanelSheet } from "./category-panel-sheet";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: mocks.toastSuccess, error: vi.fn() }),
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const SPACE = { id: "space-1" };
const API = { GET: mocks.get, PATCH: mocks.patch, POST: mocks.post } as unknown as ApiClient;

function category(
  overrides: Partial<CategoryRead> & Pick<CategoryRead, "id" | "name">,
): CategoryRead {
  return { kind: "expense", icon: "tag", parent_id: null, archived_at: null, ...overrides };
}

const TRANSPORTE = category({ id: "c1", name: "Transporte", icon: "car" });
const TAXI = category({ id: "c2", name: "Taxi y apps", icon: "taxi", parent_id: "c1" });
const MASCOTAS = category({
  id: "c9",
  name: "Mascotas",
  icon: "paw-print",
  archived_at: "2026-10-18T15:00:00Z",
});
const TRABAJO = category({ id: "c5", name: "Trabajo", kind: "income", icon: "briefcase" });
const LIST = [TRANSPORTE, TAXI, TRABAJO, MASCOTAS];

const ok = (data: unknown, status = 200) => ({ data, response: new Response(null, { status }) });
const failure = (status: number, body?: unknown) => ({
  error: body,
  response: new Response(null, { status }),
});

// The first render in jsdom pays for warming up the modules (react-hook-form, zod, Base UI, the 66 icons),
// not for what the tests check: it is done here so that no test carries that cost. A hook does not count
// against the limit of a test, and the first test of the file is the one that hit it under load.
beforeAll(async () => {
  mocks.get.mockResolvedValue(ok(LIST));
  renderPanel();
  await screen.findByLabelText("Nombre");
  cleanup();
});

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue(ok(LIST));
  mocks.patch.mockReset();
  mocks.post.mockReset();
  mocks.refresh.mockReset();
  mocks.toastSuccess.mockReset();
});

function renderPanel(props: Partial<Parameters<typeof CategoryPanelSheet>[0]> = {}) {
  const onClose = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <CategoryPanelSheet open mode="new" space={SPACE} onClose={onClose} api={API} {...props} />
    </QueryClientProvider>,
  );
  return { ...view, onClose };
}

describe("CategoryPanelSheet: Nueva categoría", () => {
  it("is a dialog 'Nueva categoría' with the form, and the focus on the name", async () => {
    renderPanel();
    const dialog = screen.getByRole("dialog", { name: "Nueva categoría" });
    const name = (await within(dialog).findByLabelText("Nombre")) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(within(dialog).getByRole("button", { name: "Crear categoría" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeTruthy();
    // The panel's picker: 66 icons, 8 columns.
    expect(within(dialog).getAllByRole("radio", { name: /./ })).toHaveLength(2 + 66);
  });

  it("asks for the categories of the space with the archived ones", async () => {
    renderPanel();
    await screen.findByLabelText("Nombre");
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get.mock.calls[0]?.[0]).toBe("/spaces/{space_id}/categories");
    expect(mocks.get.mock.calls[0]?.[1]?.params.query).toEqual({ include_archived: true });
  });

  it("starts 'Dentro de' on the principal it is told to", async () => {
    renderPanel({ defaults: { parentId: TRABAJO.id } });
    const select = (await screen.findByLabelText("Dentro de")) as HTMLSelectElement;
    expect(select.value).toBe(TRABAJO.id);
    expect((screen.getByLabelText("Ingreso") as HTMLInputElement).checked).toBe(true);
  });

  it("does not ask for anything while it is closed", () => {
    renderPanel({ open: false });
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("closes first and refreshes the server data after it, when a category is created", async () => {
    mocks.post.mockResolvedValue(ok(category({ id: "new", name: "Gimnasio" }), 201));
    const { onClose } = renderPanel();
    fireEvent.change(await screen.findByLabelText("Nombre"), { target: { value: "Gimnasio" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear categoría" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(onClose.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.refresh.mock.invocationCallOrder[0]!,
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Creaste «Gimnasio»");
  });

  it("closes without refreshing on 'Cancelar'", async () => {
    const { onClose } = renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("closes with Escape", async () => {
    const { onClose } = renderPanel();
    await screen.findByLabelText("Nombre");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows a skeleton while the categories load", () => {
    mocks.get.mockReturnValue(new Promise(() => {}));
    renderPanel();
    expect(screen.getByRole("dialog", { name: "Nueva categoría" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Cargando las categorías" })).toBeTruthy();
    expect(screen.queryByLabelText("Nombre")).toBeNull();
  });

  it("shows an Alert with Reintentar inside the panel when they fail to load", async () => {
    mocks.get.mockResolvedValueOnce(failure(500, { code: "internal_error", detail: "x" }));
    renderPanel();
    expect(await screen.findByText("Algo salió mal de nuestro lado")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByLabelText("Nombre")).toBeTruthy();
  });
});

describe("CategoryPanelSheet: Editar categoría", () => {
  it("shows the edit form of the category and puts the focus on the name", async () => {
    renderPanel({ mode: "edit", categoryId: TRANSPORTE.id });
    const dialog = screen.getByRole("dialog", { name: "Editar categoría" });
    const name = (await within(dialog).findByLabelText("Nombre")) as HTMLInputElement;
    expect(name.value).toBe("Transporte");
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(within(dialog).getByText("Categoría de gasto · principal")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Guardar cambios" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /Archivar categoría/ })).toBeTruthy();
  });

  it("closes and refreshes after saving a change", async () => {
    mocks.patch.mockResolvedValue(ok({ ...TRANSPORTE, name: "Movilidad" }));
    const { onClose } = renderPanel({ mode: "edit", categoryId: TRANSPORTE.id });
    fireEvent.change(await screen.findByLabelText("Nombre"), { target: { value: "Movilidad" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("closes without a request or a refresh when nothing changed", async () => {
    const { onClose } = renderPanel({ mode: "edit", categoryId: TRANSPORTE.id });
    fireEvent.click(await screen.findByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("closes and refreshes after archiving, with 'Deshacer' in the toast", async () => {
    mocks.post.mockResolvedValue(ok({ ...TRANSPORTE, archived_at: "2026-10-28T12:00:00Z" }));
    const { onClose } = renderPanel({ mode: "edit", categoryId: TRANSPORTE.id });
    fireEvent.click(await screen.findByRole("button", { name: /Archivar categoría/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Archivaste «Transporte»",
      expect.objectContaining({ action: expect.objectContaining({ label: "Deshacer" }) }),
    );
  });

  it("names the principal of a subcategory", async () => {
    renderPanel({ mode: "edit", categoryId: TAXI.id });
    expect(await screen.findByText("Subcategoría de Transporte")).toBeTruthy();
  });

  it.each([
    ["is archived", MASCOTAS.id],
    ["does not exist", "gone"],
  ])("closes by itself when the category %s", async (_why, categoryId) => {
    const { onClose } = renderPanel({ mode: "edit", categoryId });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByLabelText("Nombre")).toBeNull();
  });
});

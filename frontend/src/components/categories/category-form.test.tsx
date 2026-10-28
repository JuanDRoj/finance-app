import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { categoriesQueryKey } from "@/lib/core/data/categories";
import type { CategoryRead } from "@/lib/core/data/categories";
import { CategoryForm } from "./category-form";

// The edges are mocked: the typed browser client and the toast. What is under test is the form:
// what it offers, what it sends, how a failure comes back to the fields or the Alert, what it does
// with a repeated name, and that it cannot create two categories.
const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  toastSuccess: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@/lib/api/browser", () => ({ browserApi: { POST: mocks.post } }));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess } }));

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

const COMIDA = category({ id: "cat-comida", name: "Comida", icon: "fork-knife" });
const SUPERMERCADO = category({ id: "cat-super", name: "Supermercado", parent_id: COMIDA.id });
const TRANSPORTE = category({ id: "cat-transporte", name: "Transporte", icon: "car" });
const MASCOTAS = category({
  id: "cat-mascotas",
  name: "Mascotas",
  icon: "paw-print",
  archived_at: "2026-10-18T15:00:00Z",
});
const VETERINARIA = category({
  id: "cat-vet",
  name: "Veterinaria",
  parent_id: MASCOTAS.id,
  archived_at: "2026-10-18T15:00:00Z",
});
const TRABAJO = category({ id: "cat-trabajo", name: "Trabajo", kind: "income", icon: "briefcase" });
const CATEGORIES = [COMIDA, SUPERMERCADO, TRANSPORTE, MASCOTAS, VETERINARIA, TRABAJO];

function ok(data: unknown, status = 200) {
  return { data, response: new Response(null, { status }) };
}

function failure(status: number, body?: unknown) {
  return { error: body, response: new Response(null, { status }) };
}

const CREATED = category({ id: "cat-new", name: "Gimnasio", icon: "barbell" });

beforeEach(() => {
  mocks.post.mockReset().mockResolvedValue(ok(CREATED, 201));
  mocks.toastSuccess.mockReset();
  mocks.replace.mockReset();
  vi.stubGlobal("location", { ...window.location, replace: mocks.replace });
});

function renderForm(props: Partial<Parameters<typeof CategoryForm>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const onDone = vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <CategoryForm
        space={SPACE}
        categories={CATEGORIES}
        variant="page"
        onDone={onDone}
        onCancel={onCancel}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...view, onDone, onCancel, invalidate, queryClient };
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function pick(name: string) {
  fireEvent.click(screen.getByRole("radio", { name }));
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Crear categoría" }));
}

/** The body of the one request that was sent. */
function sentBody() {
  expect(mocks.post).toHaveBeenCalledTimes(1);
  return mocks.post.mock.calls[0]?.[1]?.body;
}

function parentOptions() {
  return within(screen.getByLabelText("Dentro de"))
    .getAllByRole("option")
    .map((o) => o.textContent);
}

describe("what the form shows", () => {
  it("starts as a principal expense category with the generic icon", () => {
    renderForm();
    expect((screen.getByRole("radio", { name: "Gasto" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe("");
    expect(screen.getByLabelText("Nombre").getAttribute("placeholder")).toBe("Ej.: Gimnasio");
    expect((screen.getByRole("radio", { name: "Etiqueta" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByLabelText("Dentro de") as HTMLSelectElement).value).toBe("");
    expect(screen.getByText("Elige una principal para crearla como subcategoría.")).toBeTruthy();
  });

  it("has the type as Gasto · Ingreso, and the 66 icons as radios named in Spanish", () => {
    renderForm();
    expect(screen.getByRole("group", { name: "Tipo" })).toBeTruthy();
    expect(screen.getAllByRole("radio", { name: /^(Gasto|Ingreso)$/ })).toHaveLength(2);
    expect(screen.getByRole("group", { name: "Ícono" })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(2 + 66);
  });

  it("offers as 'Dentro de' only the active principals of the kind, with 'Ninguna' first", () => {
    renderForm();
    // Mascotas is archived, Supermercado is a subcategory and Trabajo is an income.
    expect(parentOptions()).toEqual([
      "Ninguna: es una categoría principal",
      "Comida",
      "Transporte",
    ]);
  });

  it("offers the principals of the other kind when the type changes, and empties 'Dentro de'", () => {
    renderForm();
    type("Dentro de", COMIDA.id);
    expect((screen.getByLabelText("Dentro de") as HTMLSelectElement).value).toBe(COMIDA.id);
    pick("Ingreso");
    expect(parentOptions()).toEqual(["Ninguna: es una categoría principal", "Trabajo"]);
    expect((screen.getByLabelText("Dentro de") as HTMLSelectElement).value).toBe("");
  });

  it("starts on the kind it is told to", () => {
    renderForm({ defaults: { kind: "income" } });
    expect((screen.getByRole("radio", { name: "Ingreso" }) as HTMLInputElement).checked).toBe(true);
  });

  it("starts 'Dentro de' on the principal it is told to, with that principal's kind", () => {
    renderForm({ defaults: { kind: "expense", parentId: TRABAJO.id } });
    expect((screen.getByRole("radio", { name: "Ingreso" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Dentro de") as HTMLSelectElement).value).toBe(TRABAJO.id);
  });

  it.each([
    ["a subcategory", SUPERMERCADO.id],
    ["an archived principal", MASCOTAS.id],
    ["an id that is not in the list", "gone"],
  ])("ignores %s as the principal to start on", (_name, parentId) => {
    renderForm({ defaults: { parentId } });
    expect((screen.getByLabelText("Dentro de") as HTMLSelectElement).value).toBe("");
    expect((screen.getByRole("radio", { name: "Gasto" }) as HTMLInputElement).checked).toBe(true);
  });

  it("is a page with 'Crear categoría' in a fixed bar, or a panel with 'Cancelar · Crear categoría'", () => {
    const page = renderForm({ variant: "page" });
    const bar = document.querySelector("[data-slot='category-form-footer']");
    expect(bar?.className).toContain("fixed");
    expect(
      within(bar as HTMLElement).getByRole("button", { name: "Crear categoría" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
    page.unmount();
    renderForm({ variant: "panel" });
    expect(document.querySelector("[data-slot='category-form-footer']")).toBeNull();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Crear categoría" })).toBeTruthy();
  });

  it("calls onCancel from the panel's 'Cancelar'", () => {
    const { onCancel } = renderForm({ variant: "panel" });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mocks.post).not.toHaveBeenCalled();
  });
});

describe("what it sends", () => {
  it("creates a principal category: name, kind and icon, with no parent_id", async () => {
    const { onDone, invalidate } = renderForm();
    type("Nombre", "  Gimnasio ");
    pick("Pesas");
    submit();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(CREATED));
    expect(mocks.post.mock.calls[0]?.[0]).toBe("/spaces/{space_id}/categories");
    expect(mocks.post.mock.calls[0]?.[1]?.params.path).toEqual({ space_id: "space-1" });
    expect(sentBody()).toEqual({ name: "Gimnasio", kind: "expense", icon: "barbell" });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Creaste «Gimnasio»");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["spaces", "space-1", "categories"] });
  });

  it("creates a subcategory with its principal as parent_id, and the principal's kind", async () => {
    const { onDone } = renderForm();
    type("Nombre", "Verdulería");
    type("Dentro de", COMIDA.id);
    submit();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentBody()).toEqual({
      name: "Verdulería",
      kind: "expense",
      icon: "tag",
      parent_id: COMIDA.id,
    });
  });

  it("creates an income category", async () => {
    const { onDone } = renderForm();
    pick("Ingreso");
    type("Nombre", "Ventas");
    submit();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentBody()).toMatchObject({ kind: "income", name: "Ventas" });
  });

  it("creates the subcategory the 'Agregar subcategoría' of a principal asked for", async () => {
    const { onDone } = renderForm({ defaults: { parentId: TRABAJO.id } });
    type("Nombre", "Sueldo");
    submit();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentBody()).toEqual({
      name: "Sueldo",
      kind: "income",
      icon: "tag",
      parent_id: TRABAJO.id,
    });
  });

  it("shortens a very long name in the toast, not in the request", async () => {
    const long = "Nombre larguísimo ".repeat(4).trim();
    mocks.post.mockResolvedValue(ok({ ...CREATED, name: long }, 201));
    const { onDone } = renderForm();
    type("Nombre", long);
    submit();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentBody().name).toBe(long);
    const toast = mocks.toastSuccess.mock.calls[0]?.[0] as string;
    expect(toast.length).toBeLessThan(long.length);
    expect(toast).toContain("…");
  });

  it("marks the sheet's list of categories (without the archived) as old, not only Categorías'", async () => {
    const { queryClient, onDone } = renderForm();
    queryClient.setQueryData(categoriesQueryKey("space-1"), [COMIDA]);
    queryClient.setQueryData(categoriesQueryKey("space-1", { includeArchived: true }), CATEGORIES);
    queryClient.setQueryData(categoriesQueryKey("space-2"), [TRABAJO]);
    type("Nombre", "Gimnasio");
    submit();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(queryClient.getQueryState(categoriesQueryKey("space-1"))?.isInvalidated).toBe(true);
    expect(
      queryClient.getQueryState(categoriesQueryKey("space-1", { includeArchived: true }))
        ?.isInvalidated,
    ).toBe(true);
    // Another space's categories are not touched.
    expect(queryClient.getQueryState(categoriesQueryKey("space-2"))?.isInvalidated).toBe(false);
  });
});

describe("what it checks before sending", () => {
  it("asks for a name and sends nothing", async () => {
    renderForm();
    submit();
    expect(await screen.findByText("Escribe un nombre.")).toBeTruthy();
    expect(screen.getByLabelText("Nombre").getAttribute("aria-invalid")).toBe("true");
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("treats a name of spaces as empty", async () => {
    renderForm();
    type("Nombre", "     ");
    submit();
    expect(await screen.findByText("Escribe un nombre.")).toBeTruthy();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("refuses 81 characters and accepts 80", async () => {
    const { onDone } = renderForm();
    type("Nombre", "a".repeat(81));
    submit();
    expect(await screen.findByText("Usa como máximo 80 caracteres.")).toBeTruthy();
    expect(mocks.post).not.toHaveBeenCalled();
    type("Nombre", "a".repeat(80));
    submit();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});

describe("a repeated name (409 category_name_taken)", () => {
  const TAKEN = { code: "category_name_taken", detail: "A category with this name already exists" };

  it("offers to unarchive the archived category with the same name, and nothing is created", async () => {
    mocks.post.mockResolvedValue(failure(409, TAKEN));
    renderForm();
    // Different case and spaces: the unique index ignores both.
    type("Nombre", "  mascotas ");
    submit();
    expect(
      await screen.findByText(
        "Ya tienes una categoría archivada con ese nombre. Puedes desarchivarla y seguir usándola.",
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText("Nombre").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("button", { name: "Desarchivar «Mascotas»" })).toBeTruthy();
  });

  it("unarchives it, says so, leaves the form and refreshes the lists", async () => {
    mocks.post
      .mockResolvedValueOnce(failure(409, TAKEN))
      .mockResolvedValueOnce(ok({ ...MASCOTAS, archived_at: null }));
    const { onDone, invalidate } = renderForm();
    type("Nombre", "Mascotas");
    submit();
    fireEvent.click(await screen.findByRole("button", { name: "Desarchivar «Mascotas»" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.post.mock.calls[1]?.[0]).toBe(
      "/spaces/{space_id}/categories/{category_id}/unarchive",
    );
    expect(mocks.post.mock.calls[1]?.[1]?.params.path).toEqual({
      space_id: "space-1",
      category_id: MASCOTAS.id,
    });
    expect(onDone).toHaveBeenCalledWith({ ...MASCOTAS, archived_at: null });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Desarchivaste «Mascotas»");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["spaces", "space-1", "categories"] });
    // It did not create a second category.
    expect(mocks.toastSuccess).not.toHaveBeenCalledWith(expect.stringContaining("Creaste"));
  });

  it("unarchives once for a quick double tap on 'Desarchivar': one request, one toast, one onDone", async () => {
    let resolve: (value: unknown) => void = () => {};
    mocks.post
      .mockResolvedValueOnce(failure(409, TAKEN))
      .mockReturnValueOnce(new Promise((done) => (resolve = done)));
    const { onDone } = renderForm();
    type("Nombre", "Mascotas");
    submit();
    const button = await screen.findByRole("button", { name: "Desarchivar «Mascotas»" });
    // Both taps run before React renders again, so the button is still enabled for the second one.
    act(() => {
      button.click();
      button.click();
    });
    resolve(ok({ ...MASCOTAS, archived_at: null }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("lets 'Desarchivar' be tried again after it failed", async () => {
    mocks.post
      .mockResolvedValueOnce(failure(409, TAKEN))
      .mockResolvedValueOnce(failure(500, { code: "internal_error", detail: "Boom" }))
      .mockResolvedValueOnce(ok({ ...MASCOTAS, archived_at: null }));
    const { onDone } = renderForm();
    type("Nombre", "Mascotas");
    submit();
    fireEvent.click(await screen.findByRole("button", { name: "Desarchivar «Mascotas»" }));
    expect(await screen.findByText("Algo salió mal de nuestro lado")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Desarchivar «Mascotas»" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(mocks.post).toHaveBeenCalledTimes(3);
  });

  it("finds the archived sibling among the subcategories of the same principal only", async () => {
    mocks.post.mockResolvedValue(failure(409, TAKEN));
    // Veterinaria is archived, but under Mascotas (archived): creating it in Comida is not a clash
    // the list can explain, so only the plain message.
    renderForm();
    type("Nombre", "Veterinaria");
    type("Dentro de", COMIDA.id);
    submit();
    expect(await screen.findByText("Ya tienes una categoría con ese nombre.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Desarchivar/ })).toBeNull();
  });

  it("says only the name is in use when the one that clashes is active", async () => {
    mocks.post.mockResolvedValue(failure(409, TAKEN));
    renderForm();
    type("Nombre", "comida");
    submit();
    expect(await screen.findByText("Ya tienes una categoría con ese nombre.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Desarchivar/ })).toBeNull();
    expect(screen.queryByText(/Ya tienes una categoría archivada con ese nombre/)).toBeNull();
  });

  it("says the same when the list has no sibling with that name (it was created from another device)", async () => {
    mocks.post.mockResolvedValue(failure(409, TAKEN));
    renderForm();
    type("Nombre", "Algo nuevo");
    submit();
    expect(await screen.findByText("Ya tienes una categoría con ese nombre.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Desarchivar/ })).toBeNull();
  });

  it("takes the offer away when the name is changed", async () => {
    mocks.post.mockResolvedValue(failure(409, TAKEN));
    renderForm();
    type("Nombre", "Mascotas");
    submit();
    await screen.findByRole("button", { name: "Desarchivar «Mascotas»" });
    type("Nombre", "Mascotas y más");
    await waitFor(() => expect(screen.queryByRole("button", { name: /Desarchivar/ })).toBeNull());
    expect(screen.getByLabelText("Nombre").getAttribute("aria-invalid")).not.toBe("true");
  });

  it("takes the offer away when the type or the principal changes: it was about another place", async () => {
    mocks.post.mockResolvedValue(failure(409, TAKEN));
    renderForm();
    type("Nombre", "Mascotas");
    submit();
    await screen.findByRole("button", { name: "Desarchivar «Mascotas»" });
    pick("Ingreso");
    await waitFor(() => expect(screen.queryByRole("button", { name: /Desarchivar/ })).toBeNull());
    expect(screen.queryByText(/Ya tienes una categoría archivada/)).toBeNull();

    pick("Gasto");
    submit();
    await screen.findByRole("button", { name: "Desarchivar «Mascotas»" });
    type("Dentro de", COMIDA.id);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Desarchivar/ })).toBeNull());
  });

  it("lets the person try another name after the 409", async () => {
    mocks.post.mockResolvedValueOnce(failure(409, TAKEN)).mockResolvedValueOnce(ok(CREATED, 201));
    const { onDone } = renderForm();
    type("Nombre", "Comida");
    submit();
    await screen.findByText("Ya tienes una categoría con ese nombre.");
    type("Nombre", "Gimnasio");
    submit();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(CREATED));
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it("shows the error of the unarchive when it fails, and keeps the form", async () => {
    mocks.post
      .mockResolvedValueOnce(failure(409, TAKEN))
      .mockResolvedValueOnce(
        failure(404, { code: "category_not_found", detail: "Category not found" }),
      );
    const { onDone } = renderForm();
    type("Nombre", "Mascotas");
    submit();
    fireEvent.click(await screen.findByRole("button", { name: "Desarchivar «Mascotas»" }));
    expect(await screen.findByText("No encontramos esa categoría")).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("other failures", () => {
  it("marks 'Dentro de' with a 422 about the principal, and asks for the list again", async () => {
    mocks.post.mockResolvedValue(
      failure(422, {
        detail: [
          {
            type: "category_parent_archived",
            loc: ["body", "parent_id"],
            msg: "The parent category is archived",
          },
        ],
      }),
    );
    const { invalidate } = renderForm();
    type("Nombre", "Verdulería");
    type("Dentro de", COMIDA.id);
    submit();
    expect(
      await screen.findByText("Esa categoría principal está archivada. Elige otra."),
    ).toBeTruthy();
    expect(screen.getByLabelText("Dentro de").getAttribute("aria-invalid")).toBe("true");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["spaces", "space-1", "categories"] });
  });

  it("marks the name with a 422 about its length", async () => {
    mocks.post.mockResolvedValue(
      failure(422, {
        detail: [{ type: "string_too_long", loc: ["body", "name"], msg: "Too long" }],
      }),
    );
    renderForm();
    type("Nombre", "Gimnasio");
    submit();
    expect(await screen.findByText("Es demasiado largo.")).toBeTruthy();
  });

  it("shows a 422 about a field the form does not have in an Alert, in Spanish", async () => {
    mocks.post.mockResolvedValue(
      failure(422, {
        detail: [{ type: "extra_forbidden", loc: ["body", "color"], msg: "Extra inputs" }],
      }),
    );
    renderForm();
    type("Nombre", "Gimnasio");
    submit();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Hay un dato que no podemos aceptar/)).toBeTruthy();
  });

  it("shows a server error in Spanish, never the code, and lets the person try again", async () => {
    mocks.post
      .mockResolvedValueOnce(failure(500, { code: "internal_error", detail: "Boom" }))
      .mockResolvedValueOnce(ok(CREATED, 201));
    const { onDone } = renderForm();
    type("Nombre", "Gimnasio");
    submit();
    expect(await screen.findByText("Algo salió mal de nuestro lado")).toBeTruthy();
    expect(screen.queryByText(/internal_error|Boom/)).toBeNull();
    submit();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(CREATED));
  });

  it("goes to /login on a 401", async () => {
    mocks.post.mockResolvedValue(failure(401, { code: "invalid_session", detail: "x" }));
    renderForm();
    type("Nombre", "Gimnasio");
    submit();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
  });

  it("says there is no connection while the request waits, in the words of any network failure", async () => {
    onlineManager.setOnline(false);
    renderForm();
    type("Nombre", "Gimnasio");
    submit();
    expect(await screen.findByText("No pudimos conectar")).toBeTruthy();
    expect(screen.getByText(/Revisa tu conexión/)).toBeTruthy();
  });
});

describe("one category at a time", () => {
  it("sends one request for a double tap, and keeps the button busy afterwards", async () => {
    let resolve: (value: unknown) => void = () => {};
    mocks.post.mockReturnValue(new Promise((done) => (resolve = done)));
    const { onDone } = renderForm();
    type("Nombre", "Gimnasio");
    const button = screen.getByRole("button", { name: "Crear categoría" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    fireEvent.click(button);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    resolve(ok(CREATED, 201));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    // The container is leaving: a late tap must not create a second one.
    fireEvent.click(screen.getByRole("button", { name: "Crear categoría" }));
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });
});

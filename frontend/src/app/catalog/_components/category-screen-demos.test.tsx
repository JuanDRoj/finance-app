import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CategoryScreenDemo, manyCategories } from "./category-screen-demos";

// The demo runs the real screen, its rows, the archived section and the panel against a scripted
// client. This keeps the script honest: if the components change the calls they make, it fails here.
const mocks = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn(), sheet: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  // The address bar, as Next sees it: a write with `replaceState` re-renders who reads it.
  useSearchParams: () => {
    const search = useSyncExternalStore(
      (notify) => {
        window.addEventListener("test-url-changed", notify);
        return () => window.removeEventListener("test-url-changed", notify);
      },
      () => window.location.search,
      () => "",
    );
    return new URLSearchParams(search);
  },
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: mocks.toastSuccess, error: mocks.toastError }),
}));
// The panel has its own tests (category-panel-sheet.test.tsx, and category-demos.test.tsx opens the real
// one with this same scripted client). Here only the wiring is under test: what the rows ask the host
// to open, and with what.
vi.mock("@/components/categories/category-panel-sheet", () => ({
  CategoryPanelSheet: (props: { open: boolean; mode: string }) => {
    mocks.sheet(props);
    return props.open ? (
      <div
        role="dialog"
        aria-label={props.mode === "new" ? "Nueva categoría" : "Editar categoría"}
      />
    ) : null;
  },
}));
vi.mock("@/components/use-is-desktop", () => ({
  DESKTOP_MEDIA_QUERY: "(min-width: 64rem)",
  useIsDesktop: () => true,
}));

const replaceState = window.history.replaceState.bind(window.history);

// The first render of the whole screen in jsdom pays for warming up the modules, not for the screen:
// it is done here so that no test carries that cost (a hook does not count against a test's limit).
beforeAll(async () => {
  const view = render(<CategoryScreenDemo instant />);
  await screen.findByRole("region", { name: "Gastos" });
  view.unmount();
});

beforeEach(() => {
  mocks.sheet.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true })),
  );
  window.history.replaceState = (...args: Parameters<History["replaceState"]>) => {
    replaceState(...args);
    window.dispatchEvent(new Event("test-url-changed"));
  };
});

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState = replaceState;
  replaceState(null, "", "/");
});

const choose = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("CategoryScreenDemo", () => {
  it("shows the screen with the normal data: both kinds and the archived ones", async () => {
    render(<CategoryScreenDemo instant />);
    const expenses = await screen.findByRole("region", { name: "Gastos" });
    expect(within(expenses).getByText("Transporte")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Ingresos" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Categorías archivadas" })).toBeTruthy();
  });

  it("shows the loading and the error states of the list", async () => {
    render(<CategoryScreenDemo instant />);
    choose("Cómo carga la lista", "loading");
    expect(await screen.findByRole("status", { name: "Cargando categorías" })).toBeTruthy();
    choose("Cómo carga la lista", "error");
    expect(await screen.findByText("No se pudieron cargar tus categorías")).toBeTruthy();
    choose("Cómo carga la lista", "ok");
    expect(await screen.findByRole("region", { name: "Gastos" })).toBeTruthy();
  });

  it("shows the empty states of both kinds when nothing is active", async () => {
    render(<CategoryScreenDemo instant />);
    choose("Qué categorías hay", "none");
    expect(await screen.findByText("No tienes categorías de gasto activas")).toBeTruthy();
    expect(screen.getByText("No tienes categorías de ingreso activas")).toBeTruthy();
  });

  it("archives a row from desktop, with 'Deshacer' in the toast", async () => {
    render(<CategoryScreenDemo instant />);
    fireEvent.click(await screen.findByRole("button", { name: "Archivar Transporte" }));
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "Archivaste «Transporte»",
        expect.objectContaining({ action: expect.objectContaining({ label: "Deshacer" }) }),
      ),
    );
  });

  it("unarchives from the folded section", async () => {
    render(<CategoryScreenDemo instant />);
    const archived = await screen.findByRole("region", { name: "Categorías archivadas" });
    fireEvent.click(within(archived).getByRole("button", { name: /^Archivadas/ }));
    fireEvent.click(within(archived).getByRole("button", { name: "Desarchivar Mascotas" }));
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Desarchivaste «Mascotas»"),
    );
  });

  it("shows an error toast when the server fails to archive", async () => {
    render(<CategoryScreenDemo instant />);
    choose("Qué responde el servidor al archivar, desarchivar o guardar", "server");
    fireEvent.click(await screen.findByRole("button", { name: "Archivar Transporte" }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(mocks.toastError.mock.calls[0]?.[0]).toBe("Algo salió mal de nuestro lado");
  });
});

describe("the panel, from desktop", () => {
  const lastSheet = () => mocks.sheet.mock.lastCall?.[0];

  it("opens 'Editar categoría' of that category, with the scripted client, from the action of a row", async () => {
    render(<CategoryScreenDemo instant />);
    fireEvent.click(await screen.findByLabelText("Editar Transporte"));
    await screen.findByRole("dialog", { name: "Editar categoría" });
    expect(window.location.search).toBe(
      "?categoria=editar&id=00000000-0000-4000-8000-000000000002",
    );
    expect(lastSheet()).toMatchObject({
      open: true,
      mode: "edit",
      categoryId: "00000000-0000-4000-8000-000000000002",
    });
    expect(typeof lastSheet().api.GET).toBe("function");
  });

  it("opens 'Nueva categoría' with the principal chosen, from 'Agregar subcategoría'", async () => {
    render(<CategoryScreenDemo instant />);
    // The row of a phone and the "+" of desktop do the same: either opens the panel.
    const [add] = await screen.findAllByLabelText("Agregar subcategoría a Hogar");
    fireEvent.click(add as HTMLElement);
    await screen.findByRole("dialog", { name: "Nueva categoría" });
    expect(lastSheet()).toMatchObject({
      open: true,
      mode: "new",
      defaults: { parentId: "00000000-0000-4000-8000-000000000003" },
    });
  });

  it("opens 'Nueva categoría' on Ingresos from the empty state of that kind", async () => {
    render(<CategoryScreenDemo instant />);
    choose("Qué categorías hay", "none");
    const incomes = await screen.findByRole("region", { name: "Ingresos" });
    fireEvent.click(within(incomes).getByRole("link", { name: "Crear categoría" }));
    await screen.findByRole("dialog", { name: "Nueva categoría" });
    expect(lastSheet()).toMatchObject({ mode: "new", defaults: { kind: "income" } });
  });

  it("opens 'Nueva categoría' from the header action, on the tab the list shows", async () => {
    window.history.replaceState(null, "", "/?tipo=ingresos");
    render(<CategoryScreenDemo instant />);
    fireEvent.click(await screen.findByRole("link", { name: "Nueva categoría" }));
    await screen.findByRole("dialog", { name: "Nueva categoría" });
    expect(lastSheet()).toMatchObject({ mode: "new", defaults: { kind: "income" } });
  });
});

describe("the data", () => {
  it("has the worst case: the longest names, wrapped, and the whole name in the title", async () => {
    render(<CategoryScreenDemo instant />);
    choose("Qué categorías hay", "worst");
    await screen.findByRole("region", { name: "Gastos" });
    const long = screen
      .getAllByTitle(/^Gastos del consorcio/)
      .find((node) => node.className.includes("line-clamp-2"));
    expect([...(long?.getAttribute("title") ?? "")]).toHaveLength(80);
  });

  it("offers many categories: 40 principals with 12 subcategories and 30 archived", () => {
    // Rendering the 520 rows takes 1.5 to 2 s in jsdom (10 000 nodes), too long for a test: the
    // catalog has them for the eye, and the numbers are held here.
    render(<CategoryScreenDemo instant />);
    expect(
      [...(screen.getByLabelText("Qué categorías hay") as HTMLSelectElement).options].map(
        (option) => option.value,
      ),
    ).toContain("many");
    const rows = manyCategories();
    const active = rows.filter((item) => item.archived_at === null);
    expect(active.filter((item) => item.parent_id === null)).toHaveLength(40);
    expect(active.filter((item) => item.parent_id !== null)).toHaveLength(480);
    expect(rows.filter((item) => item.archived_at !== null)).toHaveLength(30);
    expect(
      rows.filter(
        (item) => item.kind === "expense" && item.parent_id === null && item.archived_at === null,
      ),
    ).toHaveLength(30);
    expect(new Set(rows.map((item) => item.id)).size).toBe(rows.length);
  });

  it("has one principal with one subcategory: the singular of every count", async () => {
    render(<CategoryScreenDemo instant />);
    choose("Qué categorías hay", "one");
    await screen.findByRole("region", { name: "Gastos" });
    expect(screen.getByText("1 principal · 1 subcategoría")).toBeTruthy();
    expect(screen.getByText("1 principal · 0 subcategorías")).toBeTruthy();
  });
});

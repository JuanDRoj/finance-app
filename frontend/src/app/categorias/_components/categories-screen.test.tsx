import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { CategoryRead } from "@/lib/core/data/categories";
import { CategoriesScreen } from "./categories-screen";

// The edges are mocked: the router, the toast and the panel (it has its own test). What is under test
// is the screen: what it asks for, its states, the two kinds and the segmented control of a phone.
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  refresh: vi.fn(),
  search: "",
  host: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/components/categories/category-panel", () => ({
  CategoryPanelHost: (props: unknown) => {
    mocks.host(props);
    return <div data-testid="panel-host" />;
  },
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

const SPACE = { id: "space-1", timezone: "America/Montevideo" };
const API = { GET: mocks.get } as unknown as ApiClient;

function category(id: string, name: string, overrides: Partial<CategoryRead> = {}): CategoryRead {
  return {
    id,
    name,
    kind: "expense",
    icon: "tag",
    parent_id: null,
    archived_at: null,
    ...overrides,
  };
}

const ARCHIVED_AT = "2026-10-18T15:00:00Z";
const LIST = [
  category("comida", "Comida", { icon: "fork-knife" }),
  category("transporte", "Transporte", { icon: "car" }),
  category("ropa", "Ropa", { icon: "t-shirt" }),
  category("trabajo", "Trabajo", { kind: "income", icon: "briefcase" }),
  category("super", "Supermercado", { parent_id: "comida" }),
  category("taxi", "Taxi y apps", { parent_id: "transporte" }),
  category("comb", "Combustible", { parent_id: "transporte" }),
  category("sueldo", "Sueldo", { kind: "income", parent_id: "trabajo" }),
  category("mascotas", "Mascotas", { archived_at: ARCHIVED_AT }),
  category("vet", "Veterinaria", { parent_id: "mascotas", archived_at: ARCHIVED_AT }),
];

const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) });
const failure = (status: number, body?: unknown) => ({
  error: body,
  response: new Response(null, { status }),
});

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue(ok(LIST));
  mocks.refresh.mockReset();
  mocks.host.mockReset();
  mocks.search = "";
});

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CategoriesScreen space={SPACE} api={API} />
    </QueryClientProvider>,
  );
}

const kindCard = (name: string) => screen.getByRole("region", { name });
const link = (id: string) =>
  document.querySelector(`a[href="/categorias/${id}"]`) as HTMLAnchorElement;

describe("what it asks for", () => {
  it("asks for the categories of the space with the archived ones, once", async () => {
    renderScreen();
    await screen.findByRole("region", { name: "Gastos" });
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith("/spaces/{space_id}/categories", {
      params: { path: { space_id: "space-1" }, query: { include_archived: true } },
    });
  });

  it("mounts the host of the panel in every state, with the space and the client", async () => {
    mocks.get.mockReturnValue(new Promise(() => {}));
    const loading = renderScreen();
    expect(screen.getByTestId("panel-host")).toBeTruthy();
    expect(mocks.host).toHaveBeenLastCalledWith({ space: SPACE, api: API });
    loading.unmount();

    mocks.get.mockResolvedValue(failure(500, { code: "internal_error", detail: "x" }));
    const failed = renderScreen();
    await screen.findByText("No se pudieron cargar tus categorías");
    expect(screen.getByTestId("panel-host")).toBeTruthy();
    failed.unmount();

    mocks.get.mockResolvedValue(ok(LIST));
    renderScreen();
    await screen.findByRole("region", { name: "Gastos" });
    expect(screen.getByTestId("panel-host")).toBeTruthy();
  });
});

describe("loading and error", () => {
  it("shows a skeleton while the categories load, and no list", () => {
    mocks.get.mockReturnValue(new Promise(() => {}));
    renderScreen();
    const status = screen.getByRole("status", { name: "Cargando categorías" });
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("region", { name: "Gastos" })).toBeNull();
  });

  it("shows the error with 'Reintentar', never 'no categories', and asks again", async () => {
    mocks.get.mockResolvedValueOnce(failure(500, { code: "internal_error", detail: "x" }));
    renderScreen();
    expect(await screen.findByText("No se pudieron cargar tus categorías")).toBeTruthy();
    expect(
      screen.getByText("Revisa tu conexión e inténtalo de nuevo; tus datos están a salvo."),
    ).toBeTruthy();
    expect(screen.queryByText(/No tienes categorías/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("region", { name: "Gastos" })).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
});

describe("the two kinds", () => {
  it("lists each kind in its card with its counts, in two levels", async () => {
    renderScreen();
    const expenses = await screen.findByRole("region", { name: "Gastos" });
    expect(within(expenses).getByText("3 principales · 3 subcategorías")).toBeTruthy();
    for (const name of ["Comida", "Supermercado", "Transporte", "Taxi y apps", "Ropa"]) {
      expect(within(expenses).getByText(name)).toBeTruthy();
    }
    const incomes = kindCard("Ingresos");
    expect(within(incomes).getByText("1 principal · 1 subcategoría")).toBeTruthy();
    expect(within(incomes).getByText("Sueldo")).toBeTruthy();
    expect(within(incomes).queryByText("Comida")).toBeNull();
  });

  it("says how many subcategories each principal has, and 'Sin subcategorías' for none", async () => {
    renderScreen();
    await screen.findByRole("region", { name: "Gastos" });
    expect(within(link("comida")).getByText("1 subcategoría")).toBeTruthy();
    expect(within(link("transporte")).getByText("2 subcategorías")).toBeTruthy();
    expect(within(link("ropa")).getByText("Sin subcategorías")).toBeTruthy();
  });

  it("links every row to the page of its category, principal or sub", async () => {
    renderScreen();
    await screen.findByRole("region", { name: "Gastos" });
    for (const id of [
      "comida",
      "super",
      "transporte",
      "taxi",
      "comb",
      "ropa",
      "trabajo",
      "sueldo",
    ]) {
      expect(link(id)).toBeTruthy();
    }
  });

  it("does not list the archived ones among the active", async () => {
    renderScreen();
    const expenses = await screen.findByRole("region", { name: "Gastos" });
    expect(within(expenses).queryByText("Mascotas")).toBeNull();
    expect(within(expenses).queryByText("Veterinaria")).toBeNull();
    expect(link("mascotas")).toBeNull();
  });

  it("gives every principal a way to add a subcategory to it", async () => {
    renderScreen();
    await screen.findByRole("region", { name: "Gastos" });
    const hrefs = screen
      .getAllByRole("link", { name: /^Agregar subcategoría a / })
      .map((anchor) => anchor.getAttribute("href"));
    expect(hrefs).toContain("/categorias/nueva?padre=comida");
    expect(hrefs).toContain("/categorias/nueva?padre=trabajo");
    expect(hrefs).not.toContain("/categorias/nueva?padre=super");
  });

  it("shows an empty state for a kind with no active category, and keeps the other one", async () => {
    mocks.get.mockResolvedValue(
      ok(
        LIST.map((item) => (item.kind === "income" ? { ...item, archived_at: ARCHIVED_AT } : item)),
      ),
    );
    renderScreen();
    const incomes = await screen.findByRole("region", { name: "Ingresos" });
    expect(within(incomes).getByText("No tienes categorías de ingreso activas")).toBeTruthy();
    expect(
      within(incomes).getByText("Crea una o desarchiva alguna de las que guardaste."),
    ).toBeTruthy();
    expect(
      within(incomes).getByRole("link", { name: "Crear categoría" }).getAttribute("href"),
    ).toBe("/categorias/nueva?tipo=ingresos");
    expect(within(kindCard("Gastos")).queryByText(/No tienes categorías/)).toBeNull();
  });

  it("shows both empty states when the space has no active category at all, archived ones below", async () => {
    mocks.get.mockResolvedValue(
      ok([category("mascotas", "Mascotas", { archived_at: ARCHIVED_AT })]),
    );
    renderScreen();
    await screen.findByText("No tienes categorías de gasto activas");
    expect(screen.getByText("No tienes categorías de ingreso activas")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Categorías archivadas" })).toBeTruthy();
  });
});

describe("the segmented control of a phone", () => {
  it("shows Gastos by default and marks the card of the other kind as hidden below 1024 px", async () => {
    renderScreen();
    await screen.findByRole("region", { name: "Gastos" });
    expect((screen.getByRole("radio", { name: "Gastos" }) as HTMLInputElement).checked).toBe(true);
    expect(kindCard("Ingresos").className).toContain("max-lg:hidden");
    expect(kindCard("Gastos").className).not.toContain("max-lg:hidden");
  });

  it("shows Ingresos when the URL says ?tipo=ingresos", async () => {
    mocks.search = "tipo=ingresos";
    renderScreen();
    await screen.findByRole("region", { name: "Gastos" });
    expect((screen.getByRole("radio", { name: "Ingresos" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(kindCard("Gastos").className).toContain("max-lg:hidden");
    expect(kindCard("Ingresos").className).not.toContain("max-lg:hidden");
  });

  it("ignores a ?tipo it does not know", async () => {
    mocks.search = "tipo=otro";
    renderScreen();
    await screen.findByRole("region", { name: "Gastos" });
    expect((screen.getByRole("radio", { name: "Gastos" }) as HTMLInputElement).checked).toBe(true);
  });

  it("writes the choice in the URL, with no request and no history entry", async () => {
    renderScreen();
    await screen.findByRole("region", { name: "Gastos" });
    const before = window.history.length;
    fireEvent.click(screen.getByRole("radio", { name: "Ingresos" }));
    expect(window.location.search).toBe("?tipo=ingresos");
    expect(window.history.length).toBe(before);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it("is hidden from 1024 px: both kinds are on screen", async () => {
    renderScreen();
    await screen.findByRole("region", { name: "Gastos" });
    expect(screen.getByRole("group", { name: "Tipo de categoría" }).className).toContain(
      "lg:hidden",
    );
  });
});

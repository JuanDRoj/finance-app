import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCategoryTree } from "@/lib/core/categories";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { CategoryRead } from "@/lib/core/data/categories";
import { CategoryCard } from "./category-card";

// The edges are mocked: the router, the toast and the API client. What is under test is the card of
// a kind: its rows, their links and actions, what a click does at each width, and archiving a row.
const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

const API = { POST: mocks.post } as unknown as ApiClient;

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

const COMIDA = category("comida", "Comida", { icon: "fork-knife" });
const SUPER = category("super", "Supermercado", { parent_id: "comida", icon: "shopping-cart" });
const CAFE = category("cafe", "Cafés", { parent_id: "comida", icon: "coffee" });
const ROPA = category("ropa", "Ropa", { icon: "t-shirt" });
const TREE = buildCategoryTree([COMIDA, SUPER, CAFE, ROPA], "expense");

const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) });
const failure = (status: number, body?: unknown) => ({
  error: body,
  response: new Response(null, { status }),
});

// The first render in jsdom pays for warming up the modules, not for the card: it is done here so that
// no test carries that cost.
beforeAll(() => {
  renderCard();
  cleanup();
});

beforeEach(() => {
  mocks.post.mockReset().mockResolvedValue(ok({ ...COMIDA, archived_at: "2026-10-28T12:00:00Z" }));
  mocks.refresh.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});

function atWidth(desktop: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: desktop })),
  );
}

function renderCard(props: Partial<Parameters<typeof CategoryCard>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CategoryCard kind="expense" tree={TREE} visible spaceId="space-1" api={API} {...props} />
    </QueryClientProvider>,
  );
}

const rowLink = (id: string) =>
  document.querySelector(`a[href="/categorias/${id}"]`) as HTMLAnchorElement;

describe("the card of a kind", () => {
  it("is a region named after the kind, with its counts", () => {
    renderCard();
    const card = screen.getByRole("region", { name: "Gastos" });
    expect(within(card).getByText("2 principales · 2 subcategorías")).toBeTruthy();
    cleanup();
    renderCard({ kind: "income", tree: [] });
    expect(screen.getByRole("region", { name: "Ingresos" })).toBeTruthy();
  });

  it("is a card of 520 px of base for Gastos and 360 for Ingresos from 1024 px", () => {
    const { unmount } = renderCard();
    expect(screen.getByRole("region", { name: "Gastos" }).className).toContain("lg:basis-130");
    unmount();
    renderCard({ kind: "income", tree: [] });
    expect(screen.getByRole("region", { name: "Ingresos" }).className).toContain("lg:basis-90");
  });

  it("is hidden below 1024 px when its kind is not the one on show, and nowhere else", () => {
    const { unmount } = renderCard({ visible: false });
    expect(screen.getByRole("region", { name: "Gastos" }).className).toContain("max-lg:hidden");
    unmount();
    renderCard({ visible: true });
    expect(screen.getByRole("region", { name: "Gastos" }).className).not.toContain("max-lg:hidden");
  });

  it("has the title for screen readers only on a phone, and the counts only from 1024 px", () => {
    renderCard();
    const title = screen.getByRole("heading", { level: 2, name: "Gastos" });
    expect(title.className).toContain("max-lg:sr-only");
    expect(title.getAttribute("tabindex")).toBe("-1");
    expect(screen.getByText("2 principales · 2 subcategorías").className).toContain(
      "max-lg:hidden",
    );
  });

  it("shows the empty state of the kind, and no list, when it has no active category", () => {
    renderCard({ tree: [] });
    expect(screen.getByText("No tienes categorías de gasto activas")).toBeTruthy();
    expect(screen.getByText("Sin categorías")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("the rows", () => {
  it("links each one to the page of its category, principal or sub, in the order of the API", () => {
    renderCard();
    // The "Editar" action of desktop goes to the same page as its row: each address once, in order.
    const hrefs = [
      ...new Set(
        [...document.querySelectorAll("a[href^='/categorias/']")]
          .map((anchor) => anchor.getAttribute("href"))
          .filter((href) => !href?.startsWith("/categorias/nueva")),
      ),
    ];
    expect(hrefs).toEqual([
      "/categorias/comida",
      "/categorias/super",
      "/categorias/cafe",
      "/categorias/ropa",
    ]);
  });

  it("puts the subcategories of a principal in a list named after it", () => {
    renderCard();
    const subs = screen.getByRole("list", { name: "Subcategorías de Comida" });
    expect(within(subs).getAllByRole("listitem")).toHaveLength(2);
    expect(within(subs).getByText("Supermercado")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Subcategorías de Ropa" })).toBeNull();
  });

  it("says the line of a principal: how many subcategories, or none (only on a phone)", () => {
    renderCard();
    expect(within(rowLink("comida")).getByText("2 subcategorías")).toBeTruthy();
    const none = within(rowLink("ropa")).getByText("Sin subcategorías");
    expect(none.className).toContain("lg:hidden");
    expect(within(rowLink("comida")).getByText("2 subcategorías").className).not.toContain(
      "lg:hidden",
    );
  });

  it("has no line under a subcategory", () => {
    renderCard();
    expect(rowLink("super").textContent).toBe("Supermercado");
  });

  it("draws the icon of each category, decorative", () => {
    renderCard();
    for (const id of ["comida", "super", "ropa"]) {
      const svg = rowLink(id).querySelector("svg[aria-hidden='true']");
      expect(svg).toBeTruthy();
    }
  });

  it("wraps a name of 80 characters in two lines at most, anywhere, and keeps it whole in title", () => {
    const long = "Gastos del consorcio, expensas comunes y fondo de reserva del edificio".padEnd(
      80,
      "x",
    );
    const tree = buildCategoryTree([category("long", long)], "expense");
    renderCard({ tree });
    const name = screen.getByText(long);
    expect(name.getAttribute("title")).toBe(long);
    expect(name.className).toContain("line-clamp-2");
    expect(name.className).toContain("wrap-anywhere");
  });
});

describe("adding a subcategory", () => {
  it("is the last row of each principal on a phone, named after it, only below 1024 px", () => {
    renderCard();
    const add = screen
      .getAllByRole("link", { name: "Agregar subcategoría a Comida" })
      .find((anchor) => anchor.textContent === "Agregar subcategoría") as HTMLElement;
    expect(add.getAttribute("href")).toBe("/categorias/nueva?padre=comida");
    expect(add.closest("div")?.className).toContain("lg:hidden");
    // One for each principal; none for a subcategory.
    expect(screen.getAllByRole("link", { name: /^Agregar subcategoría a / })).toHaveLength(4);
  });

  it("a tap on a phone follows the link", () => {
    atWidth(false);
    renderCard();
    const phoneRow = screen
      .getAllByRole("link", { name: "Agregar subcategoría a Comida" })
      .find((anchor) => anchor.textContent === "Agregar subcategoría") as HTMLElement;
    expect(fireEvent.click(phoneRow)).toBe(true);
    expect(window.location.search).toBe("");
  });

  it("a click from 1024 px opens the panel with that principal chosen, and does not navigate", () => {
    atWidth(true);
    renderCard();
    const links = screen.getAllByRole("link", { name: "Agregar subcategoría a Comida" });
    // The row of a phone and the "+" of desktop do the same.
    for (const anchor of links) {
      window.history.replaceState(null, "", "/categorias");
      expect(fireEvent.click(anchor)).toBe(false);
      expect(window.location.search).toBe("?categoria=nueva&padre=comida");
    }
  });
});

describe("the actions of a row (desktop)", () => {
  it("are, on a principal: add a subcategory, edit and archive, named after it", () => {
    renderCard();
    expect(screen.getAllByRole("link", { name: "Agregar subcategoría a Comida" })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Editar Comida" }).getAttribute("href")).toBe(
      "/categorias/comida",
    );
    expect(screen.getByRole("button", { name: "Archivar Comida" })).toBeTruthy();
  });

  it("are, on a subcategory, only edit and archive", () => {
    renderCard();
    expect(screen.getByRole("link", { name: "Editar Supermercado" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archivar Supermercado" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Agregar subcategoría a Supermercado" })).toBeNull();
  });

  it("are hidden below 1024 px, where the row is the only link", () => {
    renderCard();
    const actions = screen.getByRole("button", { name: "Archivar Comida" }).parentElement;
    expect(actions?.className).toContain("hidden");
    expect(actions?.className).toContain("lg:flex");
  });

  it("are 36 px with a mouse and 44 px with a finger, at full contrast", () => {
    renderCard();
    for (const control of [
      screen.getByRole("link", { name: "Editar Comida" }),
      screen.getByRole("button", { name: "Archivar Comida" }),
    ]) {
      expect(control.className).toContain("lg:size-9");
      expect(control.className).toContain("lg:pointer-coarse:size-11");
      expect(control.className).toContain("text-muted-foreground");
      expect(control.className).not.toMatch(/opacity|\/\d/);
    }
  });

  it("edit opens the edit panel from 1024 px, and so does a click on the name", () => {
    atWidth(true);
    renderCard();
    expect(fireEvent.click(screen.getByRole("link", { name: "Editar Supermercado" }))).toBe(false);
    expect(window.location.search).toBe("?categoria=editar&id=super");
    window.history.replaceState(null, "", "/categorias");
    expect(fireEvent.click(rowLink("ropa"))).toBe(false);
    expect(window.location.search).toBe("?categoria=editar&id=ropa");
  });

  it("a tap on a row on a phone follows the link to its page", () => {
    atWidth(false);
    renderCard();
    expect(fireEvent.click(rowLink("comida"))).toBe(true);
    expect(window.location.search).toBe("");
  });

  it("leave a modified click to the browser (a new tab)", () => {
    atWidth(true);
    renderCard();
    expect(fireEvent.click(rowLink("comida"), { ctrlKey: true })).toBe(true);
    expect(window.location.search).toBe("");
  });
});

describe("archiving a row", () => {
  it("archives with no confirmation: the toast has 'Deshacer', the lists are refreshed", async () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Archivar Comida" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.post.mock.calls[0]?.[0]).toBe(
      "/spaces/{space_id}/categories/{category_id}/archive",
    );
    expect(mocks.post.mock.calls[0]?.[1]?.params.path).toEqual({
      space_id: "space-1",
      category_id: "comida",
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Archivaste «Comida»",
      expect.objectContaining({ action: expect.objectContaining({ label: "Deshacer" }) }),
    );
  });

  it("puts the focus on the title of the card: the row and its button are about to leave", async () => {
    renderCard();
    const button = screen.getByRole("button", { name: "Archivar Ropa" });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2, name: "Gastos" }));
  });

  it("archives once for a quick double tap", async () => {
    renderCard();
    const button = screen.getByRole("button", { name: "Archivar Comida" });
    act(() => {
      button.click();
      button.click();
    });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("shows a failure in a toast, in Spanish, and archives nothing else", async () => {
    mocks.post.mockResolvedValue(
      failure(404, { code: "category_not_found", detail: "Category not found" }),
    );
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Archivar Comida" }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    expect(mocks.toastError.mock.calls[0]?.[0]).toBe("No encontramos esa categoría");
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("archives each row with its own request", async () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Archivar Comida" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Archivar Ropa" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2));
    expect(mocks.post.mock.calls.map((call) => call[1]?.params.path.category_id)).toEqual([
      "comida",
      "ropa",
    ]);
  });
});

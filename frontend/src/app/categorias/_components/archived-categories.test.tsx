import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { CategoryRead } from "@/lib/core/data/categories";
import { ArchivedCategories } from "./archived-categories";

// The edges are mocked: the router, the toast and the API client. What is under test is the folded
// section: its number, which rows it lists and what each says, and "Desarchivar".
const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  onlineManager.setOnline(true);
});

const SPACE = { id: "space-1", timezone: "America/Montevideo" };
const API = { POST: mocks.post } as unknown as ApiClient;
const OCT_18 = "2026-10-18T15:00:00Z";
const OCT_2 = "2026-10-02T15:00:00Z";

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

/**
 * Mascotas (principal archived on Oct 18) with Veterinaria (archived with it) and Paseos (archived
 * before, on its own), Viajes (a sub of the active Ocio, archived on Oct 2) and Ventas (an income).
 */
const OCIO = category("ocio", "Ocio");
const MASCOTAS = category("mascotas", "Mascotas", { icon: "paw-print", archived_at: OCT_18 });
const VET = category("vet", "Veterinaria", { parent_id: "mascotas", archived_at: OCT_18 });
const PASEOS = category("paseos", "Paseos", { parent_id: "mascotas", archived_at: OCT_2 });
const VIAJES = category("viajes", "Viajes", { parent_id: "ocio", archived_at: OCT_2 });
const VENTAS = category("ventas", "Ventas", { kind: "income", archived_at: OCT_2 });
const LIST = [OCIO, MASCOTAS, VET, PASEOS, VIAJES, VENTAS];

const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) });
const failure = (status: number, body?: unknown) => ({
  error: body,
  response: new Response(null, { status }),
});

beforeEach(() => {
  // Only the clock: "today" is fixed, and no timer is held back.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T15:00:00Z"));
  mocks.post.mockReset().mockResolvedValue(ok({ ...MASCOTAS, archived_at: null }));
  mocks.refresh.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  mocks.replace.mockReset();
  vi.stubGlobal("location", { ...window.location, replace: mocks.replace });
});

function renderSection(props: Partial<Parameters<typeof ArchivedCategories>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ArchivedCategories
        categories={LIST}
        visibleKind="expense"
        space={SPACE}
        api={API}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...view, invalidate };
}

const section = () => screen.getByRole("region", { name: "Categorías archivadas" });
const toggle = () => within(section()).getByRole("button", { name: /^Archivadas/ });
const row = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

function open() {
  fireEvent.click(toggle());
}

describe("the title", () => {
  it("is nothing when nothing is archived", () => {
    renderSection({ categories: [OCIO] });
    expect(screen.queryByRole("region", { name: "Categorías archivadas" })).toBeNull();
  });

  it("counts only the rows with a 'Desarchivar', with the number of the kind on a phone and the total on desktop", () => {
    renderSection();
    // Expenses: Mascotas and Viajes can come back; Veterinaria and Paseos wait for Mascotas. Total: + Ventas.
    const [phone, desktop] = within(toggle()).getAllByText(/^\d+$/);
    expect(phone?.textContent).toBe("2");
    expect(phone?.className).toContain("lg:hidden");
    expect(desktop?.textContent).toBe("3");
    expect(desktop?.className).toContain("max-lg:hidden");
  });

  it("counts the other kind on a phone that shows Ingresos", () => {
    renderSection({ visibleKind: "income" });
    const [phone] = within(toggle()).getAllByText(/^\d+$/);
    expect(phone?.textContent).toBe("1");
  });

  it("is folded at first, and opens and closes with the button", () => {
    renderSection();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    const list = document.getElementById(toggle().getAttribute("aria-controls") ?? "");
    expect(list?.hidden).toBe(true);
    open();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(list?.hidden).toBe(false);
    open();
    expect(list?.hidden).toBe(true);
  });
});

describe("the rows", () => {
  it("lists a principal with the subcategories archived with it under it, in the order of the API", () => {
    renderSection();
    open();
    const names = within(section())
      .getAllByRole("listitem")
      .map((item) => item.querySelector("[title]")?.textContent);
    expect(names).toEqual(["Mascotas", "Veterinaria", "Paseos", "Viajes", "Ventas"]);
  });

  it("says each line as the canvas does, with the day archived in the space's zone", () => {
    renderSection();
    open();
    expect(
      within(row("Mascotas")).getByText("Principal · archivada el 18 de octubre"),
    ).toBeTruthy();
    expect(within(row("Viajes")).getByText("En Ocio · archivada el 2 de octubre")).toBeTruthy();
  });

  it("puts the kind in front on desktop, whose list mixes both", () => {
    renderSection();
    open();
    const mascotas = row("Mascotas");
    const phone = within(mascotas).getByText("Principal · archivada el 18 de octubre");
    const desktop = within(mascotas).getByText("Gasto · principal · archivada el 18 de octubre");
    expect(phone.className).toContain("lg:hidden");
    expect(desktop.className).toContain("max-lg:hidden");
    expect(
      within(row("Ventas")).getByText("Ingreso · principal · archivada el 2 de octubre"),
    ).toBeTruthy();
  });

  it("tells a subcategory under an archived principal why it has no button, written once", () => {
    renderSection();
    open();
    const vet = row("Veterinaria");
    expect(within(vet).getByText("Se desarchiva junto con Mascotas")).toBeTruthy();
    expect(within(vet).queryByRole("button")).toBeNull();
    expect(within(vet).getAllByText(/Mascotas/)).toHaveLength(1);
    const paseos = row("Paseos");
    expect(within(paseos).getByText("Desarchiva primero Mascotas")).toBeTruthy();
    expect(within(paseos).queryByRole("button")).toBeNull();
  });

  it("indents the nested rows", () => {
    renderSection();
    open();
    expect(row("Veterinaria").className).toContain("pl-11");
    expect(row("Mascotas").className).toContain("pl-4");
  });

  it("gives a 'Desarchivar' to each row that can come back, named after it", () => {
    renderSection();
    open();
    const buttons = within(section())
      .getAllByRole("button", { name: /^Desarchivar / })
      .map((button) => button.getAttribute("aria-label"));
    expect(buttons).toEqual(["Desarchivar Mascotas", "Desarchivar Viajes", "Desarchivar Ventas"]);
  });

  it("hides the rows of the other kind below 1024 px, and shows all from there", () => {
    renderSection();
    open();
    expect(row("Ventas").className).toContain("max-lg:hidden");
    expect(row("Mascotas").className).not.toContain("max-lg:hidden");
    expect(row("Viajes").className).not.toContain("max-lg:hidden");
  });

  it("hides the whole section on a phone that shows a kind with nothing archived", () => {
    renderSection({ categories: [OCIO, VENTAS], visibleKind: "expense" });
    expect(section().className).toContain("max-lg:hidden");
    cleanup();
    renderSection({ categories: [OCIO, VENTAS], visibleKind: "income" });
    expect(section().className).not.toContain("max-lg:hidden");
  });

  it("goes without the date, instead of failing, when archived_at cannot be read", () => {
    renderSection({ categories: [category("x", "Rara", { archived_at: "ayer" })] });
    open();
    expect(within(row("Rara")).getByText("Principal")).toBeTruthy();
  });

  it("cuts a long name to two lines and keeps it whole in title", () => {
    const long =
      "Una categoría archivada con un nombre larguísimo que no cabe en una línea del celular";
    renderSection({ categories: [category("x", long, { archived_at: OCT_2 })] });
    open();
    const name = screen.getByText(long);
    expect(name.getAttribute("title")).toBe(long);
    expect(name.className).toContain("line-clamp-2");
  });
});

describe("Desarchivar", () => {
  it("unarchives with no confirmation, says so without 'Deshacer', refreshes and invalidates", async () => {
    const { invalidate } = renderSection();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Desarchivar Mascotas" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.post.mock.calls[0]?.[0]).toBe(
      "/spaces/{space_id}/categories/{category_id}/unarchive",
    );
    expect(mocks.post.mock.calls[0]?.[1]?.params.path).toEqual({
      space_id: "space-1",
      category_id: "mascotas",
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Desarchivaste «Mascotas»");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["spaces", "space-1", "categories"] });
  });

  it("unarchives once for a quick double tap", async () => {
    renderSection();
    open();
    const button = screen.getByRole("button", { name: "Desarchivar Mascotas" });
    act(() => {
      button.click();
      button.click();
    });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("makes the others wait while one is unarchived, with the spinner on the one pressed", async () => {
    let resolve: (value: unknown) => void = () => {};
    mocks.post.mockReturnValue(new Promise((done) => (resolve = done)));
    renderSection();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Desarchivar Mascotas" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Desarchivar Mascotas" }).getAttribute("aria-busy"),
      ).toBe("true"),
    );
    expect(
      screen.getByRole("button", { name: "Desarchivar Viajes" }).getAttribute("aria-disabled"),
    ).toBe("true");
    resolve(ok({ ...MASCOTAS, archived_at: null }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Desarchivar Viajes" }).getAttribute("aria-disabled"),
      ).toBeNull(),
    );
  });

  it("shows a failure in a toast, in Spanish, and keeps the row", async () => {
    mocks.post.mockResolvedValue(
      failure(404, { code: "category_not_found", detail: "Category not found" }),
    );
    renderSection();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Desarchivar Viajes" }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    expect(mocks.toastError.mock.calls[0]?.[0]).toBe("No encontramos esa categoría");
    expect(screen.getByRole("button", { name: "Desarchivar Viajes" })).toBeTruthy();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("goes to /login on a 401", async () => {
    mocks.post.mockResolvedValue(failure(401, { code: "invalid_session", detail: "x" }));
    renderSection();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Desarchivar Viajes" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
  });

  it("says there is no connection while the request waits", async () => {
    onlineManager.setOnline(false);
    renderSection();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Desarchivar Viajes" }));
    expect(await screen.findByText(/No pudimos conectar/)).toBeTruthy();
  });
});

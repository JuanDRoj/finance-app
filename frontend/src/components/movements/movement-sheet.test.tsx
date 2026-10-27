import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { CategoryRead } from "@/lib/core/data/categories";
import { MovementSheet } from "./movement-sheet";

// The edges are mocked: the width, the toast and the API client (scripted per path). The sheet and
// the form are the real ones. What is under test is the sheet: the shape per width, the data it asks
// for and when, its states, its title and its way out.
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  desktop: false,
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/api/browser", () => ({ browserApi: {} }));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess } }));
vi.mock("@/components/use-is-desktop", () => ({
  DESKTOP_MEDIA_QUERY: "(min-width: 64rem)",
  useIsDesktop: () => mocks.desktop,
}));

const api = { GET: mocks.get, POST: mocks.post } as unknown as ApiClient;

const SPACE = {
  id: "space-1",
  currency: { code: "UYU", exponent: 2 },
  timezone: "America/Montevideo",
};

function account(id: string, name: string, archived_at: string | null = null) {
  return {
    id,
    name,
    type: "bank",
    closing_day: null,
    due_day: null,
    archived_at,
    balance_minor: 0,
  } satisfies AccountWithBalance;
}
const ITAU = account("acc-itau", "Itaú");
const BROU = account("acc-brou", "BROU");

function category(name: string, overrides: Partial<CategoryRead> = {}): CategoryRead {
  return {
    id: `cat-${name}`,
    kind: "expense",
    name,
    icon: "tag",
    parent_id: null,
    archived_at: null,
    ...overrides,
  };
}
const TRANSPORTE = category("Transporte", { icon: "car" });
const CATEGORIES = [
  category("Ropa", { icon: "t-shirt" }),
  TRANSPORTE,
  category("Taxi y apps", { parent_id: TRANSPORTE.id }),
];

function ok(data: unknown, status = 200) {
  return { data, response: new Response(null, { status }) };
}

function failure(status: number, body?: unknown) {
  return { error: body, response: new Response(null, { status }) };
}

/** What the scripted API answers: the lists of the sheet, replaceable per test. */
let accounts: unknown;
let categories: unknown;

beforeEach(() => {
  mocks.desktop = false;
  accounts = ok([ITAU, BROU]);
  categories = ok(CATEGORIES);
  mocks.get
    .mockReset()
    .mockImplementation(async (path: string) =>
      path.endsWith("/accounts") ? accounts : categories,
    );
  mocks.post.mockReset().mockResolvedValue(ok({ id: "tx-1" }, 201));
  mocks.toastSuccess.mockReset();
  Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true });
});

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

type Props = Partial<Parameters<typeof MovementSheet>[0]>;

function makeUi(props: Props, queryClient: QueryClient) {
  return (
    <QueryClientProvider client={queryClient}>
      <MovementSheet
        open
        space={SPACE}
        onClose={() => {}}
        onSaved={() => {}}
        onNoAccounts={() => {}}
        api={api}
        {...props}
      />
    </QueryClientProvider>
  );
}

function renderSheet(props: Props = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const onNoAccounts = vi.fn();
  const view = render(makeUi({ onClose, onSaved, onNoAccounts, ...props }, queryClient));
  return {
    ...view,
    queryClient,
    onClose,
    onSaved,
    onNoAccounts,
    rerenderWith: (next: Props) =>
      view.rerender(makeUi({ onClose, onSaved, onNoAccounts, ...next }, queryClient)),
  };
}

const dialog = () => screen.getByRole("dialog");

describe("the sheet on a phone", () => {
  it("is a modal bottom sheet named 'Registrar movimiento' with the form once the data is in", async () => {
    renderSheet();
    expect(dialog().getAttribute("data-side")).toBe("bottom");
    expect(screen.getByRole("dialog", { name: "Registrar movimiento" })).toBeTruthy();
    expect(await screen.findByLabelText("Monto")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar gasto" })).toBeTruthy();
  });

  it("is tall, centered up to 640 px from 768 px, and has no 'Cancelar' under the button", async () => {
    renderSheet();
    await screen.findByLabelText("Monto");
    const classes = dialog().className;
    expect(classes).toContain("top-[max(2.25rem,calc(env(safe-area-inset-top,0px)+0.5rem))]");
    expect(classes).toContain("max-h-none");
    expect(classes).toContain("md:max-w-160");
    expect(classes).toContain("md:mx-auto");
    expect(dialog().querySelector("[data-slot='sheet-cancel']")).toBeNull();
    // It closes with the "Cerrar" of its header.
    expect(within(dialog()).getByRole("button", { name: "Cerrar" })).toBeTruthy();
  });

  it("shows a skeleton while the lists load, announced as busy", async () => {
    const pending: (() => void)[] = [];
    mocks.get.mockImplementation(
      (path: string) =>
        new Promise((resolve) => {
          pending.push(() => resolve(path.endsWith("/accounts") ? accounts : categories));
        }),
    );
    renderSheet();
    const status = screen.getByRole("status", { name: "Cargando" });
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByLabelText("Monto")).toBeNull();
    await act(async () => pending.forEach((resolve) => resolve()));
    expect(await screen.findByLabelText("Monto")).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Cargando" })).toBeNull();
  });

  it("asks for the accounts with the archived ones (the list Cuentas hydrates) and for the categories", async () => {
    renderSheet();
    await screen.findByLabelText("Monto");
    const calls = mocks.get.mock.calls.map(([path, options]) => [path, options]);
    expect(calls).toContainEqual([
      "/spaces/{space_id}/accounts",
      { params: { path: { space_id: "space-1" }, query: { include_archived: true } } },
    ]);
    expect(calls).toContainEqual([
      "/spaces/{space_id}/categories",
      { params: { path: { space_id: "space-1" } } },
    ]);
  });

  it("offers only the active accounts", async () => {
    accounts = ok([ITAU, account("acc-old", "Vieja", "2026-10-01T10:00:00Z"), BROU]);
    renderSheet();
    const select = await screen.findByLabelText("Cuenta");
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Itaú", "BROU"]);
  });

  it("puts the focus on the amount as the form appears", async () => {
    renderSheet();
    const amount = await screen.findByLabelText("Monto");
    await waitFor(() => expect(document.activeElement).toBe(amount));
  });

  it("asks for nothing while it is closed, and for it when it opens", async () => {
    const { rerenderWith } = renderSheet({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
    rerenderWith({ open: true });
    expect(await screen.findByLabelText("Monto")).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
});

describe("the sheet on desktop", () => {
  it("is the side panel, with the select of categories and 'Cancelar · Guardar gasto'", async () => {
    mocks.desktop = true;
    renderSheet();
    expect(dialog().getAttribute("data-side")).toBe("right");
    expect(await screen.findByLabelText("Categoría")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar gasto" })).toBeTruthy();
    expect(dialog().className).not.toContain("max-h-none");
  });

  it("does not lift itself for a keyboard: it is a panel", async () => {
    mocks.desktop = true;
    renderSheet();
    await screen.findByLabelText("Monto");
    expect(dialog().style.bottom).toBe("");
  });
});

describe("the data and its states", () => {
  it("asks the host for 'Nueva cuenta' when there is no account at all", async () => {
    accounts = ok([]);
    const { onNoAccounts } = renderSheet();
    await waitFor(() => expect(onNoAccounts).toHaveBeenCalled());
    expect(screen.queryByLabelText("Monto")).toBeNull();
  });

  it("asks for it too when every account is archived", async () => {
    accounts = ok([account("acc-old", "Vieja", "2026-10-01T10:00:00Z")]);
    const { onNoAccounts } = renderSheet();
    await waitFor(() => expect(onNoAccounts).toHaveBeenCalled());
  });

  it("does not ask for 'Nueva cuenta' while it is closed, nor with accounts", async () => {
    const { onNoAccounts } = renderSheet();
    await screen.findByLabelText("Monto");
    expect(onNoAccounts).not.toHaveBeenCalled();
    cleanup();
    accounts = ok([]);
    const closed = renderSheet({ open: false });
    await Promise.resolve();
    expect(closed.onNoAccounts).not.toHaveBeenCalled();
  });

  it("shows an error in Spanish with 'Reintentar' when the accounts fail, and recovers", async () => {
    accounts = failure(500, { code: "internal_error", detail: "boom" });
    renderSheet();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Algo salió mal de nuestro lado");
    expect(alert.textContent).not.toContain("boom");
    expect(screen.queryByLabelText("Monto")).toBeNull();
    accounts = ok([ITAU]);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByLabelText("Monto")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an error when the categories fail, and retries only what failed", async () => {
    categories = failure(500, { code: "internal_error", detail: "boom" });
    renderSheet();
    await screen.findByRole("alert");
    const accountCalls = () =>
      mocks.get.mock.calls.filter(([path]) => String(path).endsWith("/accounts")).length;
    expect(accountCalls()).toBe(1);
    categories = ok(CATEGORIES);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByLabelText("Monto")).toBeTruthy();
    expect(accountCalls()).toBe(1);
  });

  it("shows the error of a space that is not the user's, never its English detail", async () => {
    accounts = failure(404, { code: "space_not_found", detail: "Space not found" });
    renderSheet();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("No encontramos ese espacio");
    expect(alert.textContent).not.toContain("Space not found");
  });

  it("keeps the header (title and 'Cerrar') while it loads and when it fails", async () => {
    accounts = failure(500, { code: "internal_error", detail: "x" });
    renderSheet();
    expect(within(dialog()).getByRole("button", { name: "Cerrar" })).toBeTruthy();
    await screen.findByRole("alert");
    expect(within(dialog()).getByRole("button", { name: "Cerrar" })).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Registrar movimiento" })).toBeTruthy();
  });
});

describe("closing and the second step", () => {
  it.each([
    ["the Cerrar button", () => fireEvent.click(screen.getByRole("button", { name: "Cerrar" }))],
    ["Escape", () => fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })],
    [
      "a click on the veil",
      () => fireEvent.click(document.querySelector("[data-slot='sheet-overlay']") as HTMLElement),
    ],
  ])("asks to close with %s", async (_name, act) => {
    const { onClose } = renderSheet();
    await screen.findByLabelText("Monto");
    act();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks to close with 'Cancelar' of the panel", async () => {
    mocks.desktop = true;
    const { onClose } = renderSheet();
    await screen.findByLabelText("Monto");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("titles the second step with the principal and gives a 'Volver' that returns to the form", async () => {
    renderSheet();
    await screen.findByLabelText("Monto");
    expect(screen.queryByRole("button", { name: "Volver" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Transporte" }));
    expect(screen.getByRole("dialog", { name: "Transporte" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Volver" }));
    expect(screen.getByRole("dialog", { name: "Registrar movimiento" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Volver" })).toBeNull();
    // Nothing was lost on the way: the principal is chosen ("Solo Transporte").
    expect(screen.getByText("Solo Transporte")).toBeTruthy();
  });

  it("returns to the form after choosing a subcategory, with the title back", async () => {
    renderSheet();
    await screen.findByLabelText("Monto");
    fireEvent.click(screen.getByRole("button", { name: "Transporte" }));
    fireEvent.click(screen.getByRole("radio", { name: "Taxi y apps" }));
    expect(screen.getByRole("dialog", { name: "Registrar movimiento" })).toBeTruthy();
    expect(screen.getByText("Transporte › Taxi y apps")).toBeTruthy();
  });

  it("opens again on the form, not on the second step it was closed in", async () => {
    const { rerenderWith } = renderSheet();
    await screen.findByLabelText("Monto");
    fireEvent.click(screen.getByRole("button", { name: "Transporte" }));
    expect(screen.getByRole("dialog", { name: "Transporte" })).toBeTruthy();
    rerenderWith({ open: false });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    rerenderWith({ open: true });
    expect(await screen.findByRole("dialog", { name: "Registrar movimiento" })).toBeTruthy();
    expect(await screen.findByLabelText("Monto")).toBeTruthy();
  });

  it("opens with a blank form each time", async () => {
    const { rerenderWith } = renderSheet();
    fireEvent.change(await screen.findByLabelText("Monto"), { target: { value: "123" } });
    rerenderWith({ open: false });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    rerenderWith({ open: true });
    expect((await screen.findByLabelText("Monto")) as HTMLInputElement).toHaveProperty("value", "");
  });

  it("does not show the second step on desktop, where categories are a select", async () => {
    mocks.desktop = true;
    renderSheet();
    await screen.findByLabelText("Monto");
    expect(screen.queryByRole("button", { name: "Volver" })).toBeNull();
    expect(screen.queryByText(/Elige una subcategoría/)).toBeNull();
  });
});

describe("registering from the sheet", () => {
  it("tells the host once the movement is registered, after the toast", async () => {
    const { onSaved, onClose } = renderSheet();
    fireEvent.change(await screen.findByLabelText("Monto"), { target: { value: "2340,50" } });
    fireEvent.click(screen.getByRole("button", { name: "Ropa" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Registraste «Ropa»");
    // Closing is the host's job (it closes first and refreshes after): the sheet only reports.
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.post.mock.calls[0]?.[1]?.body).toMatchObject({
      type: "expense",
      account_id: "acc-itau",
      category_id: "cat-Ropa",
      amount_minor: 234050,
    });
  });

  it("hands over to 'Nueva cuenta' from the notice of a transfer with one account", async () => {
    accounts = ok([ITAU]);
    const { onNoAccounts } = renderSheet();
    await screen.findByLabelText("Monto");
    fireEvent.click(screen.getByRole("radio", { name: "Transferencia" }));
    fireEvent.click(screen.getByRole("button", { name: "Nueva cuenta" }));
    expect(onNoAccounts).toHaveBeenCalledTimes(1);
  });
});

describe("the keyboard on a phone", () => {
  class FakeViewport extends EventTarget {
    height = 800;
    offsetTop = 0;
  }

  it("lifts the bottom edge by what the keyboard covers (iOS), so the button stays above it", async () => {
    const viewport = new FakeViewport();
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
    renderSheet();
    await screen.findByLabelText("Monto");
    expect(dialog().style.bottom).toBe("");
    act(() => {
      viewport.height = 500;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(dialog().style.bottom).toBe("300px");
    act(() => {
      viewport.height = 800;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(dialog().style.bottom).toBe("");
  });
});

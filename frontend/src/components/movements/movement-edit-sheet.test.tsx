import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import type { CategoryRead } from "@/lib/core/data/categories";
import { transactionDetailKey, type MovementListItem } from "@/lib/core/data/transactions";
import { MovementEditSheet } from "./movement-edit-sheet";
import { MovementLink } from "./movement-link";
import { scriptedMovementsApi, type Fault, type ScriptedCall } from "./scripted-movements-api";

// The edges are mocked (router, toast, the width); the sheet, the form, the detail and the hook that
// deletes are the real ones, talking to the scripted backend of Movimientos.
const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  desktop: true,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: mocks.toastSuccess, error: mocks.toastError }),
}));
vi.mock("@/components/use-is-desktop", () => ({
  DESKTOP_MEDIA_QUERY: "(min-width: 64rem)",
  useIsDesktop: () => mocks.desktop,
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  onlineManager.setOnline(true);
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const SPACE = {
  id: "space-1",
  currency: { code: "UYU", exponent: 2 },
  timezone: "America/Montevideo",
};

const id = (n: number) => `0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c00${String(n).padStart(2, "0")}`;
const UBER_ID = id(10);
const AJUSTE_ID = id(11);
const PENDIENTE_ID = id(12);
const ARCHIVADA_ID = id(13);
const ROPA_ID = id(14);
const GONE_ID = id(99);

function account(
  uuid: string,
  name: string,
  archived = false,
  type: AccountWithBalance["type"] = "bank",
): AccountWithBalance {
  return {
    id: uuid,
    name,
    type,
    closing_day: null,
    due_day: null,
    archived_at: archived ? "2026-09-01T10:00:00Z" : null,
    balance_minor: 0,
  };
}
const ITAU = account(id(1), "Itaú");
const BROU = account(id(2), "BROU");
const VIEJA = account(id(3), "Cuenta vieja", true);
const ACCOUNTS = [ITAU, BROU, VIEJA];

function category(uuid: string, name: string, extra: Partial<CategoryRead> = {}): CategoryRead {
  return {
    id: uuid,
    name,
    kind: "expense",
    icon: "tag",
    parent_id: null,
    archived_at: null,
    ...extra,
  };
}
const TRANSPORTE = category(id(20), "Transporte", { icon: "car" });
const TAXI = category(id(21), "Taxi y apps", { icon: "taxi", parent_id: TRANSPORTE.id });
const ROPA = category(id(22), "Ropa", { icon: "t-shirt", archived_at: "2026-09-01T10:00:00Z" });
const CATEGORIES = [TRANSPORTE, TAXI, ROPA];

const refOf = (a: AccountWithBalance) => ({ id: a.id, name: a.name, type: a.type });

function movement(overrides: Partial<MovementListItem>): MovementListItem {
  return {
    id: UBER_ID,
    type: "expense",
    status: "confirmed",
    date: "2026-10-19",
    description: "Uber",
    amount_minor: -38000,
    category: { id: TAXI.id, name: "Taxi y apps", icon: "taxi", parent: null },
    account: refOf(ITAU),
    from_account: null,
    to_account: null,
    balance_after_minor: null,
    ...overrides,
  };
}

const MOVEMENTS = [
  movement({}),
  movement({
    id: AJUSTE_ID,
    type: "adjustment",
    description: null,
    amount_minor: -30000,
    category: null,
    date: "2026-10-13",
    account: refOf(BROU),
  }),
  movement({ id: PENDIENTE_ID, status: "pending", description: "Alquiler" }),
  movement({ id: ARCHIVADA_ID, description: "Compra vieja", account: refOf(VIEJA) }),
  movement({
    id: ROPA_ID,
    description: "Campera",
    category: { id: ROPA.id, name: "Ropa", icon: "t-shirt", parent: null },
  }),
];

function makeApi(
  fault?: (call: ScriptedCall) => Fault | undefined,
  delay?: (call: ScriptedCall) => number,
) {
  return scriptedMovementsApi({
    items: () => MOVEMENTS,
    accounts: () => ACCOUNTS,
    categories: () => CATEGORIES,
    fault,
    delay,
  });
}

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  mocks.desktop = true;
});

type ScreenProps = {
  api: ReturnType<typeof makeApi>;
  movementId?: string;
  onSaved?: () => void;
  onDeleted?: () => void;
  onExited?: () => void;
  queryClient?: QueryClient;
  /** Whether the row that opens it is in the page (an address can open it with no row). */
  withLink?: boolean;
};

/** The screen behind the sheet: a title, the link that opens it and the sheet, which this harness opens and closes. */
function Screen({
  api,
  movementId = UBER_ID,
  onSaved = () => {},
  onDeleted = () => {},
  onExited,
  withLink = true,
}: ScreenProps) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <h1 tabIndex={-1}>Movimientos</h1>
      {withLink ? <MovementLink movementId={movementId}>Uber</MovementLink> : null}
      <MovementEditSheet
        open={open}
        space={SPACE}
        movementId={movementId}
        api={api}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          onSaved();
        }}
        onDeleted={() => {
          setOpen(false);
          onDeleted();
        }}
        onExited={onExited}
      />
    </>
  );
}

function renderSheet(props: ScreenProps) {
  const queryClient =
    props.queryClient ??
    new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Screen {...props} />
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

const dialog = () => screen.getByRole("dialog");
const detailCalls = (api: ReturnType<typeof makeApi>) =>
  api.calls.filter((call) => call.kind === "detail");

describe("what it shows once it has the movement", () => {
  it("a movement that can be edited is the form 'Editar movimiento', with the amount focused", async () => {
    renderSheet({ api: makeApi() });
    expect(await screen.findByRole("dialog", { name: "Editar movimiento" })).toBeTruthy();
    const amount = await screen.findByLabelText("Monto");
    expect((amount as HTMLInputElement).value).toBe("380,00");
    await waitFor(() => expect(document.activeElement).toBe(amount));
    expect(within(dialog()).getByRole("button", { name: "Guardar cambios" })).toBeTruthy();
    expect(within(dialog()).getByRole("button", { name: "Eliminar movimiento" })).toBeTruthy();
  });

  it("is a skeleton while it loads, said to assistive technology", async () => {
    renderSheet({ api: makeApi((call) => (call.kind === "detail" ? "never" : undefined)) });
    const loading = await screen.findByRole("status", { name: "Cargando el movimiento" });
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Editar movimiento" })).toBeTruthy();
  });

  it("an adjustment is 'Ajuste de saldo': read only, with no form and nothing to delete", async () => {
    renderSheet({ api: makeApi(), movementId: AJUSTE_ID });
    expect(await screen.findByRole("dialog", { name: "Ajuste de saldo" })).toBeTruthy();
    expect(await screen.findByRole("link", { name: "Cuadrar saldo" })).toBeTruthy();
    expect(screen.queryByLabelText("Monto")).toBeNull();
    expect(screen.queryByRole("button", { name: /Eliminar|Guardar/ })).toBeNull();
  });

  it("a pending movement is 'Detalle del movimiento', and says why", async () => {
    renderSheet({ api: makeApi(), movementId: PENDIENTE_ID });
    expect(await screen.findByRole("dialog", { name: "Detalle del movimiento" })).toBeTruthy();
    expect(await screen.findByText(/Este movimiento está pendiente/)).toBeTruthy();
    expect(screen.queryByLabelText("Monto")).toBeNull();
  });

  it("a movement of an archived account is read only and names the account to unarchive", async () => {
    renderSheet({ api: makeApi(), movementId: ARCHIVADA_ID });
    expect(
      await screen.findByText(
        "Desarchiva «Cuenta vieja» desde Cuentas para editar o eliminar este movimiento.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ir a Cuentas" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Guardar cambios" })).toBeNull();
  });

  it("keeps the category an edited movement has even if it was archived", async () => {
    renderSheet({ api: makeApi(), movementId: ROPA_ID });
    expect((await screen.findByLabelText("Categoría")) as HTMLSelectElement).toBeTruthy();
    const select = screen.getByLabelText("Categoría") as HTMLSelectElement;
    expect(select.value).toBe(ROPA.id);
    expect(within(select).getByRole("option", { name: "Ropa (archivada)" })).toBeTruthy();
  });

  it("is the side panel from 1024 px and the bottom sheet below", async () => {
    const desktop = renderSheet({ api: makeApi() });
    await screen.findByLabelText("Monto");
    expect(dialog().getAttribute("data-side")).toBe("right");
    desktop.unmount();
    mocks.desktop = false;
    renderSheet({ api: makeApi() });
    await screen.findByLabelText("Monto");
    expect(dialog().getAttribute("data-side")).toBe("bottom");
  });

  it("asks for the movement by its id, and for the accounts and the categories with the archived ones", async () => {
    const api = makeApi();
    renderSheet({ api });
    await screen.findByLabelText("Monto");
    const detail = detailCalls(api);
    expect(detail).toHaveLength(1);
    expect(detail[0]).toMatchObject({ kind: "detail", id: UBER_ID });
    expect(api.calls.find((call) => call.kind === "accounts")?.query.include_archived).toBe(true);
    expect(api.calls.find((call) => call.kind === "categories")?.query.include_archived).toBe(true);
  });
});

describe("a copy of the movement that an earlier opening left in the cache (FE-23)", () => {
  // With `gcTime: 0` the query of the last opening can still be there for a moment when the same
  // movement is opened again; the form reads its values once, so starting on that copy would show the
  // old values, and the next "Guardar cambios" would undo the edit made in between.
  const OLD: MovementListItem = movement({ amount_minor: -10000, description: "Uber viejo" });
  const cachedClient = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.setQueryData(transactionDetailKey(SPACE.id, UBER_ID), OLD);
    return queryClient;
  };

  it("waits for the GET of this opening (a skeleton) and starts the form on what the server says now", async () => {
    const api = makeApi(undefined, (call) => (call.kind === "detail" ? 300 : 0));
    renderSheet({ api, queryClient: cachedClient() });
    // The lists answer at once and the old copy is in the cache, but the form is not drawn from it.
    expect(await screen.findByRole("status", { name: "Cargando el movimiento" })).toBeTruthy();
    await waitFor(() => expect(api.calls.some((call) => call.kind === "accounts")).toBe(true));
    await act(async () => {});
    expect(screen.queryByLabelText("Monto")).toBeNull();
    expect(screen.queryByDisplayValue("Uber viejo")).toBeNull();
    // Then the form, on the values of the server.
    const amount = (await screen.findByLabelText("Monto")) as HTMLInputElement;
    expect(amount.value).toBe("380,00");
    expect((screen.getByLabelText(/^Descripción/) as HTMLInputElement).value).toBe("Uber");
    expect(detailCalls(api)).toHaveLength(1);
  });

  it("does not let the old copy be saved over the edit made in between: what is saved is the new one", async () => {
    const api = makeApi(undefined, (call) => (call.kind === "detail" ? 100 : 0));
    const onSaved = vi.fn();
    renderSheet({ api, queryClient: cachedClient(), onSaved });
    fireEvent.change(await screen.findByLabelText("Monto"), { target: { value: "380,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    // Nothing changed against the server's movement: no PUT, whatever the old copy said.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.calls.filter((call) => call.kind === "update")).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("once the form is there, asking the movement again (an invalidation) neither hides it nor resets what was typed", async () => {
    const api = makeApi();
    const view = renderSheet({ api });
    fireEvent.change(await screen.findByLabelText("Monto"), { target: { value: "500" } });
    await act(async () => {
      await view.queryClient.invalidateQueries({
        queryKey: transactionDetailKey(SPACE.id, UBER_ID),
      });
    });
    await waitFor(() => expect(detailCalls(api)).toHaveLength(2));
    expect((screen.getByLabelText("Monto") as HTMLInputElement).value).toBe("500");
    expect(screen.queryByRole("status", { name: "Cargando el movimiento" })).toBeNull();
  });
});

describe("when it cannot show the movement", () => {
  it("a 404 says the movement is gone, with 'Cerrar' and no retry, and the lists on screen are asked again", async () => {
    const api = makeApi();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["spaces", SPACE.id, "transactions", "list", {}], { pages: [] });
    renderSheet({ api, movementId: GONE_ID, queryClient });
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("No encontramos ese movimiento")).toBeTruthy();
    expect(within(alert).queryByRole("button", { name: "Reintentar" })).toBeNull();
    expect(screen.queryByLabelText("Monto")).toBeNull();
    await waitFor(() =>
      expect(
        queryClient.getQueryState(["spaces", SPACE.id, "transactions", "list", {}])?.isInvalidated,
      ).toBe(true),
    );
    // The detail is the one that said 404: asking it again would only say it again.
    expect(detailCalls(api)).toHaveLength(1);
  });

  it("'Cerrar' of the 404 closes the sheet", async () => {
    renderSheet({ api: makeApi(), movementId: GONE_ID });
    const alert = await screen.findByRole("alert");
    fireEvent.click(within(alert).getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("a 422 (an id the API does not take; the host never lets one through) is the generic failure, in Spanish", async () => {
    renderSheet({
      api: makeApi((call) => (call.kind === "detail" ? "invalid" : undefined)),
    });
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Revisa los datos")).toBeTruthy();
    expect(screen.queryByLabelText("Monto")).toBeNull();
  });

  it("a failure of the lists says it in Spanish with 'Reintentar', which asks again", async () => {
    let failing = true;
    const api = makeApi((call) => (call.kind === "accounts" && failing ? "server" : undefined));
    renderSheet({ api });
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Algo salió mal de nuestro lado")).toBeTruthy();
    failing = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByLabelText("Monto")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a server failure of the movement is retried three times, then said with 'Reintentar'", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let failing = true;
    const api = makeApi((call) => (call.kind === "detail" && failing ? "server" : undefined));
    renderSheet({ api });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    const alert = await screen.findByRole("alert");
    expect(detailCalls(api)).toHaveLength(4);
    expect(within(alert).getByText("Algo salió mal de nuestro lado")).toBeTruthy();
    failing = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByLabelText("Monto")).toBeTruthy();
  });

  it("without a connection the queries wait instead of failing: it says so, not a skeleton for good", async () => {
    onlineManager.setOnline(false);
    renderSheet({ api: makeApi() });
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("No pudimos conectar")).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Cargando el movimiento" })).toBeNull();
  });
});

describe("saving, deleting and closing", () => {
  it("'Guardar cambios' with nothing changed closes without asking anything", async () => {
    const api = makeApi();
    renderSheet({ api });
    await screen.findByLabelText("Monto");
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.calls.filter((call) => call.kind === "update")).toHaveLength(0);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("saves, tells the host, and the server has the new amount", async () => {
    const api = makeApi();
    const onSaved = vi.fn();
    renderSheet({ api, onSaved });
    fireEvent.change(await screen.findByLabelText("Monto"), { target: { value: "400,50" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const update = api.calls.find((call) => call.kind === "update");
    expect(update).toMatchObject({ id: UBER_ID, body: { amount_minor: 40050 } });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Guardaste los cambios de «Uber»");
  });

  it("while it leaves after saving, the body stays: no skeleton and no 404 flashes under the fade", async () => {
    // The save invalidates the movements, the detail included, and the next answer is a 404.
    let gone = false;
    const api = makeApi((call) => (call.kind === "detail" && gone ? "not-found" : undefined));
    const onExited = vi.fn();
    renderSheet({ api, onExited });
    fireEvent.change(await screen.findByLabelText("Monto"), { target: { value: "400" } });
    gone = true;
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    // Closed from the very first render after saving: whatever the body is, it is the form.
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(screen.queryByText("No encontramos ese movimiento")).toBeNull();
    expect(screen.queryByRole("status", { name: "Cargando el movimiento" })).toBeNull();
    await waitFor(() => expect(onExited).toHaveBeenCalled());
  });

  it("deletes from the sheet: the toast with 'Deshacer', the host told, a refresh, and the detail is not asked again", async () => {
    const api = makeApi();
    const onDeleted = vi.fn();
    renderSheet({ api, onDeleted });
    fireEvent.click(await screen.findByRole("button", { name: "Eliminar movimiento" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Eliminaste «Uber»",
      expect.objectContaining({ action: expect.objectContaining({ label: "Deshacer" }) }),
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    await act(async () => {});
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // A sheet still mounted would have asked the server for a deleted movement (a 404).
    expect(detailCalls(api)).toHaveLength(1);
    expect(api.deleted.has(UBER_ID)).toBe(true);
  });

  describe("while it fades out (an exit animation that does not end)", () => {
    // jsdom has no animations, so the sheet would be gone at once and the fade could not be looked at.
    // Base UI waits for `getAnimations()` to finish before it unmounts: here they never do.
    beforeEach(() => {
      Object.defineProperty(Element.prototype, "getAnimations", {
        configurable: true,
        value: () => [{ finished: new Promise(() => {}) }],
      });
    });
    afterEach(() => {
      Reflect.deleteProperty(Element.prototype, "getAnimations");
    });

    it("after deleting, the form stays: the detail was taken out of the cache and nothing replaces it", async () => {
      const api = makeApi();
      const view = renderSheet({ api });
      fireEvent.click(await screen.findByRole("button", { name: "Eliminar movimiento" }));
      await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
      // The cache has no detail now, and the sheet is on its way out: it draws what it had.
      expect(
        view.queryClient.getQueryData(transactionDetailKey(SPACE.id, UBER_ID)),
      ).toBeUndefined();
      expect(screen.getByRole("dialog").getAttribute("data-ending-style")).not.toBeNull();
      expect((screen.getByLabelText("Monto") as HTMLInputElement).value).toBe("380,00");
      expect(screen.queryByText("No encontramos ese movimiento")).toBeNull();
      expect(screen.queryByRole("status", { name: "Cargando el movimiento" })).toBeNull();
      expect(detailCalls(api)).toHaveLength(1);
    });

    it("after saving, the form stays even if the next answer for the movement is a 404", async () => {
      let gone = false;
      const api = makeApi((call) => (call.kind === "detail" && gone ? "not-found" : undefined));
      renderSheet({ api });
      fireEvent.change(await screen.findByLabelText("Monto"), { target: { value: "400" } });
      gone = true;
      fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
      await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
      expect(screen.getByRole("dialog").getAttribute("data-ending-style")).not.toBeNull();
      expect((screen.getByLabelText("Monto") as HTMLInputElement).value).toBe("400");
      expect(screen.queryByText("No encontramos ese movimiento")).toBeNull();
      expect(screen.queryByRole("status", { name: "Cargando el movimiento" })).toBeNull();
    });

    it("closed without changes, the body is the one it had too (and no request is made while it leaves)", async () => {
      const api = makeApi();
      renderSheet({ api });
      await screen.findByLabelText("Monto");
      const before = api.calls.length;
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      await waitFor(() =>
        expect(screen.getByRole("dialog").getAttribute("data-ending-style")).not.toBeNull(),
      );
      expect((screen.getByLabelText("Monto") as HTMLInputElement).value).toBe("380,00");
      expect(api.calls.length).toBe(before);
    });
  });

  it("'Eliminar' waits while the delete is on its way, and a failed delete leaves the sheet open", async () => {
    const api = makeApi((call) => (call.kind === "delete" ? "server" : undefined));
    renderSheet({ api });
    fireEvent.click(await screen.findByRole("button", { name: "Eliminar movimiento" }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByLabelText("Monto")).toBeTruthy();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it.each([
    [
      "the Cerrar button",
      () => fireEvent.click(screen.getAllByRole("button", { name: "Cerrar" })[0]!),
    ],
    ["Cancelar", () => fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))],
    ["Escape", () => fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })],
    [
      "a click on the veil",
      () => fireEvent.click(document.querySelector("[data-slot='sheet-overlay']") as HTMLElement),
    ],
  ])("closes with %s, asking the host to close", async (_name, close) => {
    renderSheet({ api: makeApi() });
    await screen.findByLabelText("Monto");
    close();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("tells the host when it is gone (the animation is over), so the host can unmount it", async () => {
    const onExited = vi.fn();
    renderSheet({ api: makeApi(), onExited });
    await screen.findByLabelText("Monto");
    expect(onExited).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(onExited).toHaveBeenCalledTimes(1));
  });
});

describe("where the focus goes when it closes", () => {
  async function openedFromTheLink() {
    const view = renderSheet({ api: makeApi() });
    const link = screen.getByRole("link", { name: "Uber", hidden: true });
    link.focus();
    await screen.findByLabelText("Monto");
    return { ...view, link };
  }

  it("gives it back to the link of the movement when it closes without changes", async () => {
    const { link } = await openedFromTheLink();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(link));
  });

  it("does the same with 'Cancelar' and with nothing changed in 'Guardar cambios'", async () => {
    const { link } = await openedFromTheLink();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(link));
  });

  it("finds the link even if the browser did not focus it when it was clicked (Safari)", async () => {
    renderSheet({ api: makeApi() });
    await screen.findByLabelText("Monto");
    expect(document.activeElement).not.toBe(
      screen.getByRole("link", { name: "Uber", hidden: true }),
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("link", { name: "Uber", hidden: true })),
    );
  });

  it("takes it to the title of the screen after saving: the row may move or go", async () => {
    await openedFromTheLink();
    fireEvent.change(screen.getByLabelText("Monto"), { target: { value: "400" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Movimientos" })),
    );
  });

  it("takes it to the title of the screen after deleting, not to the row that goes away", async () => {
    const { link } = await openedFromTheLink();
    fireEvent.click(screen.getByRole("button", { name: "Eliminar movimiento" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Movimientos" })),
    );
    expect(document.activeElement).not.toBe(link);
  });

  it("goes to the title of the screen when the movement has no link on the page (opened from an address)", async () => {
    renderSheet({ api: makeApi(), withLink: false });
    await screen.findByLabelText("Monto");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Movimientos" })),
    );
  });
});

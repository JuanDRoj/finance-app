import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
  onlineManager,
  type InfiniteData,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/lib/core/data/api-client";
import {
  transactionDetailKey,
  transactionsListKey,
  transactionsSummaryKey,
  type MovementListItem,
  type MovementPage,
} from "@/lib/core/data/transactions";
import { DELETE_TOAST_MS, UNDO_FAILED_TOAST_MS, useDeleteMovement } from "./use-delete-movement";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  onlineManager.setOnline(true);
});

const SPACE = "space-1";

const UBER: MovementListItem = {
  id: "mov-uber",
  type: "expense",
  status: "confirmed",
  date: "2026-10-19",
  description: "Uber",
  amount_minor: -38000,
  category: { id: "c1", name: "Taxi y apps", icon: "taxi", parent: null },
  account: { id: "a1", name: "Itaú", type: "bank" },
  from_account: null,
  to_account: null,
  balance_after_minor: null,
};
const CAFE: MovementListItem = { ...UBER, id: "mov-cafe", description: "Café" };

function ok(data: unknown) {
  return { data, response: new Response(null, { status: 200 }) };
}
function noContent() {
  return { data: undefined, response: new Response(null, { status: 204 }) };
}
function failure(status: number, body?: unknown) {
  return { error: body, response: new Response(null, { status }) };
}

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  mocks.replace.mockReset();
  vi.stubGlobal("location", { ...window.location, replace: mocks.replace });
});

function setup(
  mocksOfApi: { del?: ReturnType<typeof vi.fn>; post?: ReturnType<typeof vi.fn> } = {},
) {
  const del = mocksOfApi.del ?? vi.fn().mockResolvedValue(noContent());
  const post = mocksOfApi.post ?? vi.fn().mockResolvedValue(ok(UBER));
  const api = { DELETE: del, POST: post } as unknown as ApiClient;
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const onDeleted = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useDeleteMovement({ spaceId: SPACE, onDeleted, api }), { wrapper });
  return { ...hook, del, post, onDeleted, invalidate, queryClient, api };
}

/** Deletes and waits for the toast of the deletion. */
async function deleted(context: ReturnType<typeof setup>, movement: MovementListItem = UBER) {
  const before = mocks.toastSuccess.mock.calls.length;
  act(() => context.result.current.remove(movement));
  await waitFor(() => expect(mocks.toastSuccess.mock.calls.length).toBe(before + 1));
  return mocks.toastSuccess.mock.calls[before]![1].action as { label: string; onClick: () => void };
}

function keysInvalidated(invalidate: { mock: { calls: unknown[][] } }) {
  return invalidate.mock.calls.map(([filters]) => (filters as { queryKey: unknown }).queryKey);
}

describe("deleting a movement", () => {
  it("sends DELETE for that movement, with no confirmation", async () => {
    const context = setup();
    await deleted(context);
    expect(context.del).toHaveBeenCalledTimes(1);
    expect(context.del.mock.calls[0]![0]).toBe("/spaces/{space_id}/transactions/{transaction_id}");
    expect(context.del.mock.calls[0]![1].params.path).toEqual({
      space_id: SPACE,
      transaction_id: "mov-uber",
    });
  });

  it("says 'Eliminaste «…»' with 'Deshacer' for 6 s, so the action can be reached", async () => {
    const context = setup();
    await deleted(context);
    expect(DELETE_TOAST_MS).toBe(6000);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Eliminaste «Uber»", {
      duration: 6000,
      action: { label: "Deshacer", onClick: expect.any(Function) },
    });
  });

  it("names the movement as the list does: its category, a transfer's accounts, cut to 40 characters", async () => {
    const context = setup();
    await deleted(context, { ...UBER, id: "x1", description: null });
    await deleted(context, {
      ...UBER,
      id: "x2",
      type: "transfer",
      description: null,
      account: null,
      category: null,
      from_account: { id: "a1", name: "Itaú", type: "bank" },
      to_account: { id: "a2", name: "Visa Itaú", type: "credit_card" },
    });
    await deleted(context, { ...UBER, id: "x3", description: "a".repeat(200) });
    expect(mocks.toastSuccess.mock.calls.map(([text]) => text)).toEqual([
      "Eliminaste «Taxi y apps»",
      "Eliminaste «Itaú → Visa Itaú»",
      `Eliminaste «${"a".repeat(39)}…»`,
    ]);
  });

  it("asks for the balances and the movements again, and refreshes the server data", async () => {
    const context = setup();
    await deleted(context);
    expect(keysInvalidated(context.invalidate)).toEqual([
      ["spaces", SPACE, "accounts"],
      ["spaces", SPACE, "transactions"],
    ]);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("takes the movement out of every list in the cache at once, and leaves the rest", async () => {
    const context = setup();
    const page = (...items: MovementListItem[]): InfiniteData<MovementPage, string | null> => ({
      pages: [{ items, next_cursor: null }],
      pageParams: [null],
    });
    const october = transactionsListKey(SPACE, { month: "2026-10" });
    const summary = transactionsSummaryKey(SPACE, { month: "2026-10" });
    context.queryClient.setQueryData(october, page(UBER, CAFE));
    context.queryClient.setQueryData(summary, { count: 2 });
    await deleted(context);
    const left = context.queryClient.getQueryData<InfiniteData<MovementPage>>(october);
    expect(left?.pages[0]?.items.map((item) => item.id)).toEqual(["mov-cafe"]);
    expect(context.queryClient.getQueryData(summary)).toEqual({ count: 2 });
  });

  it("calls onDeleted after the toast and before the refresh, so a sheet that closes there is closed when the page refreshes", async () => {
    const context = setup();
    await deleted(context);
    expect(context.onDeleted).toHaveBeenCalledWith(UBER);
    const order = (mock: { mock: { invocationCallOrder: number[] } }) =>
      mock.mock.invocationCallOrder[0]!;
    expect(order(mocks.toastSuccess)).toBeLessThan(order(context.onDeleted));
    expect(order(context.onDeleted)).toBeLessThan(order(mocks.refresh));
  });

  it("is busy while it runs: pendingId is the movement being deleted, and nothing after", async () => {
    let finish: (value: unknown) => void = () => {};
    const del = vi.fn().mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const context = setup({ del });
    expect(context.result.current.pendingId).toBeNull();
    act(() => context.result.current.remove(UBER));
    expect(context.result.current.pendingId).toBe("mov-uber");
    await act(async () => finish(noContent()));
    await waitFor(() => expect(context.result.current.pendingId).toBeNull());
  });

  it("deletes once with two taps in the same instant: one request, one toast, one refresh", async () => {
    const context = setup();
    await act(async () => {
      context.result.current.remove(UBER);
      context.result.current.remove(UBER);
    });
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(context.del).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not delete again a movement already deleted and not undone", async () => {
    const context = setup();
    await deleted(context);
    act(() => context.result.current.remove(UBER));
    await act(async () => {});
    expect(context.del).toHaveBeenCalledTimes(1);
  });

  it("deletes another movement while one is on its way: the hook can be shared by every row", async () => {
    let finish: (value: unknown) => void = () => {};
    const del = vi
      .fn()
      .mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
      .mockResolvedValue(noContent());
    const context = setup({ del });
    act(() => context.result.current.remove(UBER));
    act(() => context.result.current.remove(CAFE));
    await waitFor(() => expect(del).toHaveBeenCalledTimes(2));
    await act(async () => finish(noContent()));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledTimes(2));
    expect(mocks.toastSuccess.mock.calls.map(([text]) => text).sort()).toEqual([
      "Eliminaste «Café»",
      "Eliminaste «Uber»",
    ]);
  });

  it("sends the request even without a connection, and says it failed, instead of queueing it", async () => {
    onlineManager.setOnline(false);
    const del = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const context = setup({ del });
    act(() => context.result.current.remove(UBER));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(del).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith("No pudimos conectar", {
      description: expect.stringContaining("Revisa tu conexión"),
    });
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("several deletes at once (pendingId)", () => {
  /** A DELETE that stays on its way until the test lets it finish. */
  function held() {
    let finish: (value: unknown) => void = () => {};
    const promise = new Promise((resolve) => (finish = resolve));
    return { promise, finish: (value: unknown) => act(async () => finish(value)) };
  }

  it("keeps the later movement busy when the earlier one finishes first", async () => {
    const a = held();
    const b = held();
    const del = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const context = setup({ del });
    act(() => context.result.current.remove(UBER));
    act(() => context.result.current.remove(CAFE));
    expect(context.result.current.pendingId).toBe("mov-cafe");
    await a.finish(noContent());
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledTimes(1));
    // A is done; B is still on its way, and its button must keep saying so.
    expect(context.result.current.pendingId).toBe("mov-cafe");
    await b.finish(noContent());
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledTimes(2));
    expect(context.result.current.pendingId).toBeNull();
  });

  it("keeps the later movement busy when the earlier one fails first", async () => {
    const a = held();
    const b = held();
    const del = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const context = setup({ del });
    act(() => context.result.current.remove(UBER));
    act(() => context.result.current.remove(CAFE));
    await a.finish(failure(500));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    expect(context.result.current.pendingId).toBe("mov-cafe");
    await b.finish(failure(500));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(2));
    expect(context.result.current.pendingId).toBeNull();
  });

  it("clears it when the last one asked for is the one that ends", async () => {
    const a = held();
    const b = held();
    const del = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const context = setup({ del });
    act(() => context.result.current.remove(UBER));
    act(() => context.result.current.remove(CAFE));
    await b.finish(noContent());
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledTimes(1));
    expect(context.result.current.pendingId).toBeNull();
    await a.finish(noContent());
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledTimes(2));
    expect(context.result.current.pendingId).toBeNull();
  });
});

describe("the detail of a movement that was deleted", () => {
  const detailKey = transactionDetailKey(SPACE, "mov-uber");

  it("is taken out of the cache, and the one of another movement stays", async () => {
    const context = setup();
    const other = transactionDetailKey(SPACE, "mov-cafe");
    context.queryClient.setQueryData(detailKey, UBER);
    context.queryClient.setQueryData(other, CAFE);
    await deleted(context);
    expect(context.queryClient.getQueryData(detailKey)).toBeUndefined();
    expect(context.queryClient.getQueryState(detailKey)).toBeUndefined();
    expect(context.queryClient.getQueryData(other)).toEqual(CAFE);
    // The other movement's detail is invalidated with the rest, as before.
    expect(context.queryClient.getQueryState(other)?.isInvalidated).toBe(true);
  });

  it("is not asked again by a sheet that is still mounted on it (it would be a 404)", async () => {
    const context = setup();
    const queryFn = vi.fn().mockResolvedValue(UBER);
    const observer = new QueryObserver(context.queryClient, {
      queryKey: detailKey,
      queryFn,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    await deleted(context);
    await act(async () => {});
    expect(queryFn).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("is still asked again when what changed is not a delete: another movement's invalidation reaches it", async () => {
    // The root of the movements is invalidated (a save, an undo): a sheet on the detail refetches.
    const context = setup();
    const queryFn = vi.fn().mockResolvedValue(UBER);
    const unsubscribe = new QueryObserver(context.queryClient, {
      queryKey: detailKey,
      queryFn,
      staleTime: Infinity,
    }).subscribe(() => {});
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    await deleted(context, CAFE);
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    unsubscribe();
  });

  it("stays in the cache when the delete fails: the movement is still there", async () => {
    const del = vi.fn().mockResolvedValue(failure(500));
    const context = setup({ del });
    context.queryClient.setQueryData(detailKey, UBER);
    act(() => context.result.current.remove(UBER));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(context.queryClient.getQueryData(detailKey)).toEqual(UBER);
  });
});

describe("when the delete fails", () => {
  it("says why in Spanish, calls nothing else and lets the person try again", async () => {
    const del = vi.fn().mockResolvedValueOnce(failure(500)).mockResolvedValueOnce(noContent());
    const context = setup({ del });
    act(() => context.result.current.remove(UBER));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    expect(mocks.toastError).toHaveBeenCalledWith("Algo salió mal de nuestro lado", {
      description: expect.any(String),
    });
    expect(context.onDeleted).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(context.result.current.pendingId).toBeNull();
    // The guard is let go: the same movement can be deleted again.
    await deleted(context);
    expect(del).toHaveBeenCalledTimes(2);
  });

  it("a 404 says the movement is gone and asks the lists again: what is on screen is old", async () => {
    const del = vi
      .fn()
      .mockResolvedValue(failure(404, { code: "transaction_not_found", detail: "x" }));
    const context = setup({ del });
    act(() => context.result.current.remove(UBER));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(mocks.toastError.mock.calls[0]![0]).toBe("No encontramos ese movimiento");
    expect(keysInvalidated(context.invalidate)).toEqual([
      ["spaces", SPACE, "accounts"],
      ["spaces", SPACE, "transactions"],
    ]);
  });

  it("a 409 transaction_not_editable sends an adjustment to 'Cuadrar saldo'", async () => {
    const del = vi
      .fn()
      .mockResolvedValue(failure(409, { code: "transaction_not_editable", detail: "x" }));
    const context = setup({ del });
    act(() => context.result.current.remove({ ...UBER, type: "adjustment" }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(mocks.toastError.mock.calls[0]![0]).toBe("Este movimiento no se puede cambiar");
    expect(mocks.toastError.mock.calls[0]![1].description).toContain("Cuadrar saldo");
  });

  it("a 409 account_archived says to unarchive the account to delete this movement", async () => {
    const del = vi.fn().mockResolvedValue(failure(409, { code: "account_archived", detail: "x" }));
    const context = setup({ del });
    act(() => context.result.current.remove(UBER));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(mocks.toastError).toHaveBeenCalledWith("Esa cuenta está archivada", {
      description: "Desarchívala desde Cuentas para poder eliminar este movimiento.",
    });
  });

  it("an expired session goes to /login, with no toast", async () => {
    const del = vi.fn().mockResolvedValue(failure(401, { code: "invalid_session", detail: "x" }));
    const context = setup({ del });
    act(() => context.result.current.remove(UBER));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("'Deshacer'", () => {
  it("restores the movement, asks the balances and the movements again and refreshes", async () => {
    const context = setup();
    const action = await deleted(context);
    context.invalidate.mockClear();
    mocks.refresh.mockClear();
    act(() => action.onClick());
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(context.post).toHaveBeenCalledTimes(1);
    expect(context.post.mock.calls[0]![0]).toBe(
      "/spaces/{space_id}/transactions/{transaction_id}/restore",
    );
    expect(context.post.mock.calls[0]![1].params.path).toEqual({
      space_id: SPACE,
      transaction_id: "mov-uber",
    });
    expect(keysInvalidated(context.invalidate)).toEqual([
      ["spaces", SPACE, "accounts"],
      ["spaces", SPACE, "transactions"],
    ]);
  });

  it("says nothing when it works: the row coming back is the confirmation", async () => {
    const context = setup();
    const action = await deleted(context);
    act(() => action.onClick());
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2));
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("restores once with two taps in the same instant", async () => {
    const context = setup();
    const action = await deleted(context);
    await act(async () => {
      action.onClick();
      action.onClick();
    });
    await waitFor(() => expect(context.post).toHaveBeenCalled());
    expect(context.post).toHaveBeenCalledTimes(1);
  });

  it("lets the movement be deleted again after it was restored", async () => {
    const context = setup();
    const action = await deleted(context);
    act(() => action.onClick());
    await waitFor(() => expect(context.post).toHaveBeenCalled());
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2));
    await deleted(context);
    expect(context.del).toHaveBeenCalledTimes(2);
  });

  it("still works after the sheet or the row that deleted is gone: the toast outlives it", async () => {
    const context = setup();
    const action = await deleted(context);
    context.unmount();
    act(() => action.onClick());
    await waitFor(() => expect(context.post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2));
  });

  describe("when it fails", () => {
    it("explains an archived account and offers nothing to retry: asking again would give the same answer", async () => {
      const post = vi
        .fn()
        .mockResolvedValue(failure(409, { code: "account_archived", detail: "x" }));
      const context = setup({ post });
      const action = await deleted(context);
      act(() => action.onClick());
      await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
      const [title, options] = mocks.toastError.mock.calls[0]!;
      expect(title).toBe("No se pudo deshacer");
      expect(options.description).toContain("Desarchívala desde Cuentas");
      expect(options.description).toContain("registra el movimiento de nuevo");
      expect(options.action).toBeUndefined();
      // The list and the balances are as the delete left them: nothing was undone.
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
    });

    it("says the movement is gone on a 404, with no retry", async () => {
      const post = vi
        .fn()
        .mockResolvedValue(failure(404, { code: "transaction_not_found", detail: "x" }));
      const context = setup({ post });
      const action = await deleted(context);
      act(() => action.onClick());
      await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
      expect(mocks.toastError.mock.calls[0]![0]).toBe("No se pudo deshacer");
      expect(mocks.toastError.mock.calls[0]![1].description).toContain(
        "Puede que ya lo hayas eliminado",
      );
      expect(mocks.toastError.mock.calls[0]![1].action).toBeUndefined();
    });

    it("offers 'Reintentar' for 10 s without a connection, and retrying restores it", async () => {
      const post = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce(ok(UBER));
      const context = setup({ post });
      const action = await deleted(context);
      act(() => action.onClick());
      await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
      const options = mocks.toastError.mock.calls[0]![1];
      expect(UNDO_FAILED_TOAST_MS).toBe(10_000);
      expect(options.duration).toBe(10_000);
      expect(options.description).toContain("Revisa tu conexión");
      expect(options.action.label).toBe("Reintentar");
      mocks.refresh.mockClear();
      act(() => options.action.onClick());
      await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
      expect(post).toHaveBeenCalledTimes(2);
      expect(mocks.toastError).toHaveBeenCalledTimes(1);
    });

    it("offers 'Reintentar' on a server failure, and the first 'Deshacer' can be pressed again", async () => {
      const post = vi.fn().mockResolvedValueOnce(failure(503)).mockResolvedValueOnce(ok(UBER));
      const context = setup({ post });
      const action = await deleted(context);
      act(() => action.onClick());
      await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
      expect(mocks.toastError.mock.calls[0]![1].action.label).toBe("Reintentar");
      // The guard is let go on a failure, so a toast that is still on screen can try again.
      act(() => action.onClick());
      await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    });

    it("sends an expired session to /login", async () => {
      const post = vi
        .fn()
        .mockResolvedValue(failure(401, { code: "invalid_session", detail: "x" }));
      const context = setup({ post });
      const action = await deleted(context);
      act(() => action.onClick());
      await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
      expect(mocks.toastError).not.toHaveBeenCalled();
    });
  });
});

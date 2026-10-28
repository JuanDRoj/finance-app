import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/lib/core/data/api-client";
import { categoriesQueryKey, type CategoryRead } from "@/lib/core/data/categories";
import { useUnarchiveCategory } from "./use-unarchive-category";

const mocks = vi.hoisted(() => ({
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
  vi.unstubAllGlobals();
  onlineManager.setOnline(true);
});

const ARCHIVED: CategoryRead = {
  id: "cat-1",
  name: "Mascotas",
  kind: "expense",
  icon: "paw-print",
  parent_id: null,
  archived_at: "2026-10-18T15:00:00Z",
};
const RESTORED = { ...ARCHIVED, archived_at: null };

const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) });
const failure = (status: number, body?: unknown) => ({
  error: body,
  response: new Response(null, { status }),
});

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  mocks.replace.mockReset();
  vi.stubGlobal("location", { ...window.location, replace: mocks.replace });
});

function setup(post: ReturnType<typeof vi.fn>) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const api = { POST: post } as unknown as ApiClient;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useUnarchiveCategory({ spaceId: "space-1", api }), { wrapper });
  return { ...hook, invalidate, queryClient };
}

describe("useUnarchiveCategory", () => {
  it("unarchives with no confirmation, says so without 'Deshacer', invalidates and refreshes", async () => {
    const post = vi.fn().mockResolvedValue(ok(RESTORED));
    const { result, invalidate } = setup(post);
    act(() => result.current.unarchive(ARCHIVED));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[0]).toBe("/spaces/{space_id}/categories/{category_id}/unarchive");
    expect(post.mock.calls[0]?.[1]?.params.path).toEqual({
      space_id: "space-1",
      category_id: "cat-1",
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Desarchivaste «Mascotas»");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["spaces", "space-1", "categories"] });
  });

  it("marks the list of the sheet of 'Registrar movimiento' as old, so it offers the category again", async () => {
    const post = vi.fn().mockResolvedValue(ok(RESTORED));
    const { result, queryClient } = setup(post);
    queryClient.setQueryData(categoriesQueryKey("space-1"), []);
    act(() => result.current.unarchive(ARCHIVED));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(queryClient.getQueryState(categoriesQueryKey("space-1"))?.isInvalidated).toBe(true);
  });

  it("refreshes the page only after the lists were asked for again", async () => {
    const post = vi.fn().mockResolvedValue(ok(RESTORED));
    const { result, invalidate } = setup(post);
    act(() => result.current.unarchive(ARCHIVED));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(invalidate.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.refresh.mock.invocationCallOrder[0]!,
    );
  });

  it("shortens a long name in the toast", async () => {
    const long = {
      ...RESTORED,
      name: "Una categoría con un nombre larguísimo que no cabe en el aviso",
    };
    const post = vi.fn().mockResolvedValue(ok(long));
    const { result } = setup(post);
    act(() => result.current.unarchive(ARCHIVED));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    const text = mocks.toastSuccess.mock.calls[0]?.[0] as string;
    expect(text.startsWith("Desarchivaste «Una categoría")).toBe(true);
    expect(text).toContain("…»");
  });

  it("says which category is busy while it runs, and none after", async () => {
    let resolve: (value: unknown) => void = () => {};
    const post = vi.fn().mockReturnValue(new Promise((done) => (resolve = done)));
    const { result } = setup(post);
    expect(result.current.busyId).toBeUndefined();
    act(() => result.current.unarchive(ARCHIVED));
    await waitFor(() => expect(result.current.busyId).toBe("cat-1"));
    resolve(ok(RESTORED));
    await waitFor(() => expect(result.current.busyId).toBeUndefined());
  });

  it("unarchives once for a quick double tap: one request, one toast, one refresh", async () => {
    let resolve: (value: unknown) => void = () => {};
    const post = vi.fn().mockReturnValue(new Promise((done) => (resolve = done)));
    const { result } = setup(post);
    // Both taps run before React renders again, so `busyId` is still undefined for the second.
    act(() => {
      result.current.unarchive(ARCHIVED);
      result.current.unarchive(ARCHIVED);
    });
    resolve(ok(RESTORED));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("does not start another one while one runs, but does once it settled", async () => {
    let resolve: (value: unknown) => void = () => {};
    const other = { ...ARCHIVED, id: "cat-2", name: "Viajes" };
    const post = vi
      .fn()
      .mockReturnValueOnce(new Promise((done) => (resolve = done)))
      .mockResolvedValueOnce(ok({ ...other, archived_at: null }));
    const { result } = setup(post);
    act(() => result.current.unarchive(ARCHIVED));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    act(() => result.current.unarchive(other));
    await act(async () => {});
    expect(post).toHaveBeenCalledTimes(1);
    resolve(ok(RESTORED));
    await waitFor(() => expect(result.current.busyId).toBeUndefined());
    act(() => result.current.unarchive(other));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2));
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("shows the error in a toast, in Spanish, and lets the person try again", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce(failure(409, { code: "category_parent_archived", detail: "x" }))
      .mockResolvedValueOnce(ok(RESTORED));
    const { result } = setup(post);
    act(() => result.current.unarchive(ARCHIVED));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    expect(mocks.toastError.mock.calls[0]?.[0]).toBe("Su categoría principal está archivada");
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.busyId).toBeUndefined());
    act(() => result.current.unarchive(ARCHIVED));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("goes to /login on a 401, without a toast", async () => {
    const post = vi.fn().mockResolvedValue(failure(401, { code: "invalid_session", detail: "x" }));
    const { result } = setup(post);
    act(() => result.current.unarchive(ARCHIVED));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("is paused while there is no connection, and goes out when it returns", async () => {
    onlineManager.setOnline(false);
    const post = vi.fn().mockResolvedValue(ok(RESTORED));
    const { result } = setup(post);
    act(() => result.current.unarchive(ARCHIVED));
    await waitFor(() => expect(result.current.paused).toBe(true));
    expect(post).not.toHaveBeenCalled();
    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  });
});

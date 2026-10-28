import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/lib/core/data/api-client";
import { categoriesQueryKey, type CategoryRead } from "@/lib/core/data/categories";
import { useArchiveCategory } from "./use-archive-category";

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
});

const CATEGORY: CategoryRead = {
  id: "cat-1",
  name: "Mascotas",
  kind: "expense",
  icon: "paw-print",
  parent_id: null,
  archived_at: null,
};
const ARCHIVED = { ...CATEGORY, archived_at: "2026-10-28T12:00:00Z" };

function ok(data: unknown) {
  return { data, response: new Response(null, { status: 200 }) };
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

function setup(post: ReturnType<typeof vi.fn>) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const onArchived = vi.fn();
  const api = { POST: post } as unknown as ApiClient;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useArchiveCategory({ spaceId: "space-1", onArchived, api }), {
    wrapper,
  });
  return { ...hook, onArchived, invalidate, queryClient };
}

describe("useArchiveCategory", () => {
  it("archives, invalidates the categories, shows the toast with 'Deshacer' and calls onArchived", async () => {
    const post = vi.fn().mockResolvedValue(ok(ARCHIVED));
    const { result, onArchived, invalidate } = setup(post);
    act(() => result.current.archive(CATEGORY));
    await waitFor(() => expect(onArchived).toHaveBeenCalledWith(ARCHIVED));
    expect(post.mock.calls[0]?.[0]).toBe("/spaces/{space_id}/categories/{category_id}/archive");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["spaces", "space-1", "categories"] });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Archivaste «Mascotas»", {
      action: { label: "Deshacer", onClick: expect.any(Function) },
    });
  });

  it("marks the list of the sheet of 'Registrar movimiento' as old, so it stops offering it", async () => {
    const post = vi.fn().mockResolvedValue(ok(ARCHIVED));
    const { result, onArchived, queryClient } = setup(post);
    queryClient.setQueryData(categoriesQueryKey("space-1"), [CATEGORY]);
    act(() => result.current.archive(CATEGORY));
    await waitFor(() => expect(onArchived).toHaveBeenCalled());
    expect(queryClient.getQueryState(categoriesQueryKey("space-1"))?.isInvalidated).toBe(true);
  });

  it("'Deshacer' unarchives it (the backend brings back the subcategories archived with it) and refreshes", async () => {
    const post = vi.fn().mockResolvedValueOnce(ok(ARCHIVED)).mockResolvedValueOnce(ok(CATEGORY));
    const { result, onArchived, invalidate } = setup(post);
    act(() => result.current.archive(CATEGORY));
    await waitFor(() => expect(onArchived).toHaveBeenCalled());
    invalidate.mockClear();
    const action = mocks.toastSuccess.mock.calls[0]?.[1].action;
    act(() => action.onClick());
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[1]?.[0]).toBe("/spaces/{space_id}/categories/{category_id}/unarchive");
    expect(post.mock.calls[1]?.[1]?.params.path).toEqual({
      space_id: "space-1",
      category_id: "cat-1",
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["spaces", "space-1", "categories"] });
  });

  it("shows a toast when 'Deshacer' fails, in Spanish", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce(ok(ARCHIVED))
      .mockResolvedValueOnce(failure(409, { code: "category_parent_archived", detail: "x" }));
    const { result, onArchived } = setup(post);
    act(() => result.current.archive(CATEGORY));
    await waitFor(() => expect(onArchived).toHaveBeenCalled());
    act(() => mocks.toastSuccess.mock.calls[0]?.[1].action.onClick());
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(mocks.toastError.mock.calls[0]?.[0]).toBe("Su categoría principal está archivada");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("shortens a long name in the toast", async () => {
    const long = {
      ...ARCHIVED,
      name: "Una categoría con un nombre larguísimo que no cabe en el aviso",
    };
    const post = vi.fn().mockResolvedValue(ok(long));
    const { result, onArchived } = setup(post);
    act(() => result.current.archive(CATEGORY));
    await waitFor(() => expect(onArchived).toHaveBeenCalled());
    const text = mocks.toastSuccess.mock.calls[0]?.[0] as string;
    expect(text.startsWith("Archivaste «Una categoría")).toBe(true);
    expect(text).toContain("…»");
  });

  it("keeps the error in Spanish, and does not call onArchived", async () => {
    const post = vi
      .fn()
      .mockResolvedValue(failure(500, { code: "internal_error", detail: "Boom" }));
    const { result, onArchived } = setup(post);
    act(() => result.current.archive(CATEGORY));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.title).toBe("Algo salió mal de nuestro lado");
    expect(onArchived).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
    // A new attempt clears the old error.
    post.mockResolvedValue(ok(ARCHIVED));
    act(() => result.current.archive(CATEGORY));
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(onArchived).toHaveBeenCalled());
  });

  it("goes to /login on a 401", async () => {
    const post = vi.fn().mockResolvedValue(failure(401, { code: "invalid_session", detail: "x" }));
    const { result } = setup(post);
    act(() => result.current.archive(CATEGORY));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
  });

  it("is busy while it archives and after it did, until the container leaves", async () => {
    let resolve: (value: unknown) => void = () => {};
    const post = vi.fn().mockReturnValue(new Promise((done) => (resolve = done)));
    const { result, onArchived } = setup(post);
    act(() => result.current.archive(CATEGORY));
    await waitFor(() => expect(result.current.busy).toBe(true));
    resolve(ok(ARCHIVED));
    await waitFor(() => expect(onArchived).toHaveBeenCalled());
    expect(result.current.busy).toBe(true);
  });
});

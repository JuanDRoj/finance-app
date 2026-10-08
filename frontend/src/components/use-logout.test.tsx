import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_ENDED_ATTRIBUTE } from "./bfcache-guard";
import { useLogout } from "./use-logout";

// These are the tests of the former `LogoutButton` (KAN-27), moved one to one when the logout
// went into the avatar menu: the logic did not change, only who calls it. The edges are mocked:
// the typed API client, the toast and the full-page navigation. What is under test is the hook's
// own logic: one request, the busy state, what is cleared and where it goes on success, and what
// the user sees when it fails. That the menu item calls it is tested in user-menu.test.tsx.
const mocks = vi.hoisted(() => ({
  del: vi.fn(),
  toastError: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@/lib/api/browser", () => ({ browserApi: { DELETE: mocks.del } }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute(SESSION_ENDED_ATTRIBUTE);
});

beforeEach(() => {
  mocks.del.mockReset().mockResolvedValue({ response: new Response(null, { status: 204 }) });
  mocks.toastError.mockReset();
  mocks.replace.mockReset();
  vi.stubGlobal("location", { ...window.location, replace: mocks.replace });
});

function renderLogout() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const hook = renderHook(() => useLogout(), { wrapper: Wrapper });
  return { queryClient, ...hook };
}

/** A promise that the test settles by hand, to look at the hook while the request is pending. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("useLogout", () => {
  it("is idle until it is called", () => {
    const { result } = renderLogout();
    expect(result.current.busy).toBe(false);
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it("sends DELETE /auth/session once", async () => {
    const { result } = renderLogout();
    act(() => result.current.logout());
    await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
    expect(mocks.del).toHaveBeenCalledTimes(1);
    expect(mocks.del).toHaveBeenCalledWith("/auth/session");
  });

  it("stays busy and ignores more calls while the request is pending", async () => {
    const pending = deferred<{ response: Response }>();
    mocks.del.mockReturnValue(pending.promise);
    const { result } = renderLogout();

    act(() => result.current.logout());
    await waitFor(() => expect(result.current.busy).toBe(true));
    act(() => {
      result.current.logout();
      result.current.logout();
    });
    expect(mocks.del).toHaveBeenCalledTimes(1);
    expect(mocks.replace).not.toHaveBeenCalled();

    pending.resolve({ response: new Response(null, { status: 204 }) });
    await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
  });

  it("sends one request even when it is called twice in the same tick, before React renders", async () => {
    const { result } = renderLogout();
    act(() => {
      result.current.logout();
      result.current.logout();
    });
    await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
    expect(mocks.del).toHaveBeenCalledTimes(1);
  });

  describe("when the session is closed", () => {
    it("loads /login as a new page, not with the client router", async () => {
      const { result } = renderLogout();
      act(() => result.current.logout());
      await waitFor(() => expect(mocks.replace).toHaveBeenCalledTimes(1));
      expect(mocks.replace).toHaveBeenCalledWith("/login");
    });

    it("clears everything that TanStack Query holds, so no user data stays in memory", async () => {
      const { result, queryClient } = renderLogout();
      queryClient.setQueryData(["spaces"], [{ id: "s1", name: "Mi espacio" }]);
      queryClient.setQueryData(["me"], { email: "ana@example.com" });
      expect(queryClient.getQueryCache().getAll()).toHaveLength(2);

      act(() => result.current.logout());
      await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    });

    it("marks the page as ended, so a copy restored from the back/forward cache shows nothing", async () => {
      const { result } = renderLogout();
      act(() => result.current.logout());
      await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
      expect(document.documentElement.getAttribute(SESSION_ENDED_ATTRIBUTE)).toBe("true");
    });

    it("stays busy until the new page replaces this one: no second request", async () => {
      const { result } = renderLogout();
      act(() => result.current.logout());
      await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
      expect(result.current.busy).toBe(true);
      act(() => result.current.logout());
      expect(mocks.del).toHaveBeenCalledTimes(1);
    });

    it("shows no error", async () => {
      const { result } = renderLogout();
      act(() => result.current.logout());
      await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
      expect(mocks.toastError).not.toHaveBeenCalled();
    });
  });

  describe("when it fails", () => {
    function backendError(status: number, code: string) {
      return {
        error: { detail: "English detail that must not be shown", code },
        response: new Response(null, { status }),
      };
    }

    it("tells the user in Spanish, never the English detail or the code, and does not leave", async () => {
      mocks.del.mockResolvedValue(backendError(403, "origin_not_allowed"));
      const { result } = renderLogout();
      act(() => result.current.logout());

      await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
      const [title, options] = mocks.toastError.mock.calls[0] as [string, { description: string }];
      expect(title).toBe("No pudimos cerrar tu sesión");
      expect(options.description).toContain("Recarga la página e inténtalo de nuevo");
      expect(JSON.stringify(mocks.toastError.mock.calls)).not.toMatch(
        /English detail|origin_not_allowed/,
      );
      expect(mocks.replace).not.toHaveBeenCalled();
      expect(document.documentElement.hasAttribute(SESSION_ENDED_ATTRIBUTE)).toBe(false);
    });

    it("says there is no connection when the request cannot be made", async () => {
      mocks.del.mockRejectedValue(new TypeError("Failed to fetch"));
      const { result } = renderLogout();
      act(() => result.current.logout());

      await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
      const [, options] = mocks.toastError.mock.calls[0] as [string, { description: string }];
      expect(options.description).toContain("Revisa tu conexión");
      expect(mocks.replace).not.toHaveBeenCalled();
    });

    it("lets the user try again, and the second try can succeed", async () => {
      mocks.del.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      const { result } = renderLogout();

      act(() => result.current.logout());
      await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(result.current.busy).toBe(false));

      act(() => result.current.logout());
      await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
      expect(mocks.del).toHaveBeenCalledTimes(2);
    });
  });
});

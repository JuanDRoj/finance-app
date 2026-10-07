import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_ENDED_ATTRIBUTE } from "./bfcache-guard";
import { LogoutButton } from "./logout-button";

// The edges are mocked: the typed API client, the toast and the full-page navigation. What is
// under test is the button's own logic: one request, the busy state, what is cleared and where it
// goes on success, and what the user sees when it fails.
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

function renderButton() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <LogoutButton />
    </QueryClientProvider>,
  );
  return queryClient;
}

function button() {
  return screen.getByRole("button", { name: "Cerrar sesión" });
}

function isBusy(element: HTMLElement) {
  return element.getAttribute("aria-busy") === "true";
}

/** A promise that the test settles by hand, to look at the button while the request is pending. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("LogoutButton", () => {
  it("is a button named 'Cerrar sesión'", () => {
    renderButton();
    expect(button().textContent).toBe("Cerrar sesión");
  });

  it("sends DELETE /auth/session once", async () => {
    renderButton();
    fireEvent.click(button());
    await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
    expect(mocks.del).toHaveBeenCalledTimes(1);
    expect(mocks.del).toHaveBeenCalledWith("/auth/session");
  });

  it("stays busy and ignores more clicks while the request is pending", async () => {
    const pending = deferred<{ response: Response }>();
    mocks.del.mockReturnValue(pending.promise);
    renderButton();

    fireEvent.click(button());
    await waitFor(() => expect(isBusy(button())).toBe(true));
    fireEvent.click(button());
    fireEvent.click(button());
    expect(mocks.del).toHaveBeenCalledTimes(1);
    expect(mocks.replace).not.toHaveBeenCalled();

    pending.resolve({ response: new Response(null, { status: 204 }) });
    await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
  });

  describe("when the session is closed", () => {
    it("loads /login as a new page, not with the client router", async () => {
      renderButton();
      fireEvent.click(button());
      await waitFor(() => expect(mocks.replace).toHaveBeenCalledTimes(1));
      expect(mocks.replace).toHaveBeenCalledWith("/login");
    });

    it("clears everything that TanStack Query holds, so no user data stays in memory", async () => {
      const queryClient = renderButton();
      queryClient.setQueryData(["spaces"], [{ id: "s1", name: "Mi espacio" }]);
      queryClient.setQueryData(["me"], { email: "ana@example.com" });
      expect(queryClient.getQueryCache().getAll()).toHaveLength(2);

      fireEvent.click(button());
      await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    });

    it("marks the page as ended, so a copy restored from the back/forward cache shows nothing", async () => {
      renderButton();
      fireEvent.click(button());
      await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
      expect(document.documentElement.getAttribute(SESSION_ENDED_ATTRIBUTE)).toBe("true");
    });

    it("stays busy until the new page replaces this one: no second request", async () => {
      renderButton();
      fireEvent.click(button());
      await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
      expect(isBusy(button())).toBe(true);
      fireEvent.click(button());
      expect(mocks.del).toHaveBeenCalledTimes(1);
    });

    it("shows no error", async () => {
      renderButton();
      fireEvent.click(button());
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
      renderButton();
      fireEvent.click(button());

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
      renderButton();
      fireEvent.click(button());

      await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
      const [, options] = mocks.toastError.mock.calls[0] as [string, { description: string }];
      expect(options.description).toContain("Revisa tu conexión");
      expect(mocks.replace).not.toHaveBeenCalled();
    });

    it("lets the user try again, and the second try can succeed", async () => {
      mocks.del.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      renderButton();

      fireEvent.click(button());
      await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(isBusy(button())).toBe(false));

      fireEvent.click(button());
      await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
      expect(mocks.del).toHaveBeenCalledTimes(2);
    });
  });
});

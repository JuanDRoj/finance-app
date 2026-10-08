import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_ENDED_ATTRIBUTE } from "./bfcache-guard";
import { LogoutProvider, useLogoutState } from "./logout-provider";

// The edges are mocked as in use-logout.test.tsx. What is under test: that every consumer under
// one provider sees the same state and the same guard, and that a consumer without a provider
// fails loudly instead of quietly keeping a state of its own.
const mocks = vi.hoisted(() => ({
  del: vi.fn(),
  toastError: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@/lib/api/browser", () => ({ browserApi: { DELETE: mocks.del } }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

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

function wrapper({ children }: Readonly<{ children: ReactNode }>) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <LogoutProvider>{children}</LogoutProvider>
    </QueryClientProvider>
  );
}

describe("LogoutProvider", () => {
  it("gives every consumer the same busy state", async () => {
    mocks.del.mockReturnValue(new Promise(() => {}));
    function Consumer({ name }: Readonly<{ name: string }>) {
      const { logout, busy } = useLogoutState();
      return (
        <button type="button" aria-label={name} aria-busy={busy} onClick={logout}>
          {name}
        </button>
      );
    }
    render(
      <>
        <Consumer name="uno" />
        <Consumer name="dos" />
      </>,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("button", { name: "uno" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "dos" }).getAttribute("aria-busy")).toBe("true"),
    );
    expect(screen.getByRole("button", { name: "uno" }).getAttribute("aria-busy")).toBe("true");
  });

  it("shares one guard: a call from each consumer in the same tick sends one request", async () => {
    // Two consumers under the same provider, collected from one tree.
    const seen: Array<ReturnType<typeof useLogoutState>> = [];
    function Probe() {
      seen.push(useLogoutState());
      return null;
    }
    render(
      <>
        <Probe />
        <Probe />
      </>,
      { wrapper },
    );
    expect(seen.length).toBeGreaterThanOrEqual(2);
    const [one, two] = seen.slice(-2) as [(typeof seen)[number], (typeof seen)[number]];

    act(() => {
      one.logout();
      two.logout();
    });
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(mocks.del).toHaveBeenCalledTimes(1);
  });

  it("fails loudly when a consumer has no provider above it", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useLogoutState())).toThrow(/LogoutProvider/);
    quiet.mockRestore();
  });
});

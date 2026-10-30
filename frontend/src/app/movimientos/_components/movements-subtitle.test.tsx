import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/lib/core/data/api-client";
import { MovementsSubtitle } from "./movements-subtitle";

vi.mock("next/navigation", () => ({
  useSearchParams: () => {
    const search = useSyncExternalStore(
      (notify) => {
        window.addEventListener("test-url-changed", notify);
        return () => window.removeEventListener("test-url-changed", notify);
      },
      () => window.location.search,
      () => "",
    );
    return new URLSearchParams(search);
  },
}));

const replaceState = window.history.replaceState.bind(window.history);

beforeEach(() => {
  window.history.replaceState = (...args: Parameters<History["replaceState"]>) => {
    replaceState(...args);
    window.dispatchEvent(new Event("test-url-changed"));
  };
});

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  window.history.replaceState = replaceState;
  replaceState(null, "", "/");
});

const COUNTS: Record<string, number> = { "2026-10": 48, "2026-09": 1, "2026-08": 0 };

/** A client whose summary answers by month, after `delay` (a promise a test can release). */
function scripted(release?: Promise<void>) {
  const calls: Array<Record<string, string>> = [];
  const api = {
    GET: vi.fn(async (_path: string, init: { params: { query?: Record<string, string> } }) => {
      calls.push(init.params.query ?? {});
      if (release) await release;
      const count = COUNTS[init.params.query?.month ?? ""] ?? 7;
      return {
        data: { count, income_minor: 0, expense_minor: 0, remaining_minor: 0 },
        response: new Response(null, { status: 200 }),
      };
    }),
  } as unknown as ApiClient;
  return { api, calls };
}

function renderLine(api: ApiClient, url = "/movimientos") {
  replaceState(null, "", url);
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <p data-testid="line">
        <MovementsSubtitle spaceId="s1" currentMonth="2026-10" api={api} />
      </p>
    </QueryClientProvider>,
  );
}

const line = () => screen.getByTestId("line").textContent;

describe("MovementsSubtitle", () => {
  it("writes the month alone while the summary loads, then the month and the count", async () => {
    const { api } = scripted();
    renderLine(api);
    expect(line()).toBe("Octubre 2026");
    await waitFor(() => expect(line()).toBe("Octubre 2026 · 48 movimientos"));
  });

  it("asks for the summary of the same filters as the screen: the month and the type", async () => {
    const { api, calls } = scripted();
    renderLine(api, "/movimientos?mes=2026-09&tipo=gastos&q=uber");
    await waitFor(() => expect(line()).toContain("1 movimiento"));
    expect(calls).toEqual([{ month: "2026-09", type: "expense", q: "uber" }]);
  });

  it("says 'movimiento' for one", async () => {
    const { api } = scripted();
    renderLine(api, "/movimientos?mes=2026-09");
    await waitFor(() => expect(line()).toBe("Setiembre 2026 · 1 movimiento"));
  });

  it("leaves the count out when there are none: the month alone, like the canvas's empty screen", async () => {
    const { api, calls } = scripted();
    renderLine(api, "/movimientos?mes=2026-08");
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => {});
    expect(line()).toBe("Agosto 2026");
  });

  it("leaves the count out when the summary fails", async () => {
    const api = {
      GET: vi.fn(async () => ({ error: undefined, response: new Response(null, { status: 500 }) })),
    } as unknown as ApiClient;
    renderLine(api);
    await act(async () => {});
    expect(line()).toBe("Octubre 2026");
  });

  it("follows the URL: a new month changes the line, and never shows the old count next to it", async () => {
    let release!: () => void;
    const { api } = scripted();
    renderLine(api);
    await waitFor(() => expect(line()).toBe("Octubre 2026 · 48 movimientos"));
    // The summary of September is slow: until it arrives the line is just the month.
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(api.GET).mockImplementationOnce((async (...args: unknown[]) => {
      await gate;
      return {
        data: { count: 1, income_minor: 0, expense_minor: 0, remaining_minor: 0 },
        response: new Response(null, { status: 200 }),
        args,
      };
    }) as never);
    act(() => window.history.replaceState(null, "", "/movimientos?mes=2026-09"));
    await waitFor(() => expect(line()).toBe("Setiembre 2026"));
    expect(line()).not.toContain("48");
    release();
    await waitFor(() => expect(line()).toBe("Setiembre 2026 · 1 movimiento"));
  });
});

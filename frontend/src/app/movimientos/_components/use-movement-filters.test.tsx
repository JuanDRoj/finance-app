import { act, cleanup, renderHook } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMovementFilters } from "./use-movement-filters";

// The address bar as Next.js sees it: a write with `replaceState` makes who reads it render again.
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

const CURRENT = "2026-10";
const ID_A = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0002";
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

function setup(url = "/movimientos") {
  replaceState(null, "", url);
  return renderHook(() => useMovementFilters(CURRENT));
}

describe("useMovementFilters", () => {
  it("reads the filters from the URL, and the current month when it has none", () => {
    expect(setup().result.current.filters).toEqual({ month: CURRENT });
    cleanup();
    const { result } = setup(`/movimientos?mes=2026-08&tipo=ingresos&q=sueldo&cuenta_id=${ID_A}`);
    expect(result.current.filters).toEqual({
      month: "2026-08",
      type: "income",
      q: "sueldo",
      accountId: ID_A,
    });
  });

  it("ignores what the URL says wrong, as the server does", () => {
    const { result } = setup("/movimientos?mes=2026-13&tipo=otro&cuenta_id=abc&q=%20%20");
    expect(result.current.filters).toEqual({ month: CURRENT });
  });

  it("writes a change into the URL with replaceState and renders again with it", () => {
    const spy = vi.spyOn(window.history, "pushState");
    const { result } = setup();
    act(() => result.current.setFilters({ type: "expense" }));
    expect(window.location.search).toBe("?tipo=gastos");
    expect(result.current.filters).toEqual({ month: CURRENT, type: "expense" });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("does not write the month when it is the current one", () => {
    const { result } = setup();
    act(() => result.current.setFilters({ month: "2026-09" }));
    expect(window.location.search).toBe("?mes=2026-09");
    act(() => result.current.setFilters({ month: CURRENT }));
    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/movimientos");
  });

  it("keeps the params that are not filters, and the hash", () => {
    const { result } = setup(`/movimientos?movimiento=nuevo&sel=${ID_A}&tipo=gastos#abajo`);
    act(() => result.current.setFilters({ type: "income", q: "uber" }));
    const params = new URLSearchParams(window.location.search);
    expect(params.get("movimiento")).toBe("nuevo");
    expect(params.get("sel")).toBe(ID_A);
    expect(params.get("tipo")).toBe("ingresos");
    expect(params.get("q")).toBe("uber");
    expect(window.location.hash).toBe("#abajo");
  });

  it("does not undo a change with the next one, even before it renders", () => {
    const { result } = setup();
    // Two changes in the same tick, from the same render: the second must see the first.
    act(() => {
      result.current.setFilters({ type: "expense" });
      result.current.setFilters({ month: "2026-09" });
    });
    expect(result.current.filters).toEqual({ month: "2026-09", type: "expense" });
  });

  it("takes a filter off with undefined", () => {
    const { result } = setup("/movimientos?tipo=gastos&q=uber");
    act(() => result.current.setFilters({ type: undefined }));
    expect(window.location.search).toBe("?q=uber");
  });

  it("clears the type, the search, the account and the category, and keeps the month", () => {
    const { result } = setup(
      `/movimientos?mes=2026-07&tipo=gastos&q=uber&cuenta_id=${ID_A}&movimiento=nuevo`,
    );
    act(() => result.current.clearFilters());
    expect(result.current.filters).toEqual({ month: "2026-07" });
    const params = new URLSearchParams(window.location.search);
    expect(params.get("mes")).toBe("2026-07");
    expect(params.get("movimiento")).toBe("nuevo");
    for (const name of ["tipo", "q", "cuenta_id", "categoria_id"])
      expect(params.has(name)).toBe(false);
  });

  it("keeps the same filters object while the URL does not change", () => {
    const { result, rerender } = setup("/movimientos?tipo=gastos");
    const first = result.current.filters;
    rerender();
    expect(result.current.filters).toBe(first);
    expect(result.current.setFilters).toBe(result.current.setFilters);
  });

  it("encodes a search that needs it and reads it back whole", () => {
    const { result } = setup();
    act(() => result.current.setFilters({ q: "café & té #1" }));
    expect(result.current.filters.q).toBe("café & té #1");
    expect(window.location.search).toContain("q=caf%C3%A9");
  });
});

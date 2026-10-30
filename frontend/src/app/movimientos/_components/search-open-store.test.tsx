import { act, cleanup, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setSearchOpen, useSearchOpen } from "./search-open-store";

// No vitest globals, so Testing Library does not clean up by itself. The store is module state:
// every test leaves it closed.
afterEach(() => {
  cleanup();
  setSearchOpen(false);
});

describe("the search store", () => {
  it("starts closed", () => {
    expect(renderHook(() => useSearchOpen()).result.current).toBe(false);
  });

  it("opens and closes, and tells everyone who reads it", () => {
    const first = renderHook(() => useSearchOpen());
    const second = renderHook(() => useSearchOpen());
    act(() => setSearchOpen(true));
    expect(first.result.current).toBe(true);
    expect(second.result.current).toBe(true);
    act(() => setSearchOpen(false));
    expect(first.result.current).toBe(false);
    expect(second.result.current).toBe(false);
  });

  it("does not render again for a change that is not one", () => {
    const render = vi.fn();
    renderHook(() => {
      render();
      return useSearchOpen();
    });
    const before = render.mock.calls.length;
    act(() => setSearchOpen(false));
    expect(render.mock.calls.length).toBe(before);
    act(() => setSearchOpen(true));
    act(() => setSearchOpen(true));
    expect(render.mock.calls.length).toBe(before + 1);
  });

  it("stops telling a reader that left", () => {
    const render = vi.fn();
    const { unmount } = renderHook(() => {
      render();
      return useSearchOpen();
    });
    unmount();
    const before = render.mock.calls.length;
    act(() => setSearchOpen(true));
    expect(render.mock.calls.length).toBe(before);
  });

  it("is closed on the server, even if it was left open", () => {
    setSearchOpen(true);
    function Probe() {
      return <p>{String(useSearchOpen())}</p>;
    }
    expect(renderToString(<Probe />)).toContain("false");
  });
});

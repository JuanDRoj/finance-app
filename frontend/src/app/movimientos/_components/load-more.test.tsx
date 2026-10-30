import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/core/data/errors";
import { MoreFooter, MoreSentinel, NextPageError } from "./load-more";

// jsdom has no IntersectionObserver: a fake that records what is observed and lets a test report
// that the sentinel came into view (or left it).
class FakeObserver {
  static all: FakeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(
    private callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeObserver.all.push(this);
  }
  observe(element: Element) {
    this.observed.push(element);
  }
  disconnect() {
    this.disconnected = true;
  }
  report(isIntersecting: boolean) {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this as never);
  }
  static get live() {
    return FakeObserver.all.filter((observer) => !observer.disconnected);
  }
}

let desktop = false;

beforeEach(() => {
  FakeObserver.all = [];
  desktop = false;
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: desktop, media: query }));
});

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const IDLE = { hasNextPage: true, loading: false, paused: false };

describe("MoreFooter", () => {
  it("shows the count and 'Cargar más' while there is a next page", () => {
    render(<MoreFooter {...IDLE} text="Mostrando 50 de 148 movimientos" onLoadMore={() => {}} />);
    expect(screen.getByText("Mostrando 50 de 148 movimientos")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cargar más" })).toBeTruthy();
  });

  it("has no button on the last page, only the count", () => {
    render(
      <MoreFooter
        {...IDLE}
        hasNextPage={false}
        text="Mostrando 48 de 48 movimientos"
        onLoadMore={() => {}}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Mostrando 48 de 48 movimientos")).toBeTruthy();
  });

  it("asks for the next page when the button is pressed", () => {
    const onLoadMore = vi.fn();
    render(<MoreFooter {...IDLE} text="x" onLoadMore={onLoadMore} />);
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("is busy while the page loads and ignores a second click", () => {
    const onLoadMore = vi.fn();
    render(<MoreFooter {...IDLE} loading text="x" onLoadMore={onLoadMore} />);
    const button = screen.getByRole("button", { name: "Cargar más" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("is off while paused (the rows are the previous filters' or the last page failed)", () => {
    const onLoadMore = vi.fn();
    render(<MoreFooter {...IDLE} paused text="x" onLoadMore={onLoadMore} />);
    const button = screen.getByRole("button", { name: "Cargar más" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("is 40 px tall (44 for a finger), a top line away from the table", () => {
    const { container } = render(<MoreFooter {...IDLE} text="x" onLoadMore={() => {}} />);
    expect(screen.getByRole("button", { name: "Cargar más" }).className).toContain("lg:min-h-10");
    expect(screen.getByRole("button", { name: "Cargar más" }).className).toContain(
      "lg:pointer-coarse:min-h-11",
    );
    expect(container.firstElementChild!.className).toContain("border-t");
  });

  it("moves the focus to the count when the button goes away with it (the last page arrived)", () => {
    const { rerender } = render(<MoreFooter {...IDLE} text="Mostrando 50" onLoadMore={() => {}} />);
    screen.getByRole("button", { name: "Cargar más" }).focus();
    expect(document.activeElement!.textContent).toBe("Cargar más");
    rerender(
      <MoreFooter {...IDLE} hasNextPage={false} text="Mostrando 60" onLoadMore={() => {}} />,
    );
    expect(document.activeElement).toBe(screen.getByText("Mostrando 60"));
  });

  it("does not take the focus when it was somewhere else", () => {
    const { rerender } = render(
      <div>
        <input aria-label="otro" />
        <MoreFooter {...IDLE} text="Mostrando 50" onLoadMore={() => {}} />
      </div>,
    );
    screen.getByLabelText("otro").focus();
    rerender(
      <div>
        <input aria-label="otro" />
        <MoreFooter {...IDLE} hasNextPage={false} text="Mostrando 60" onLoadMore={() => {}} />
      </div>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("otro"));
  });
});

describe("MoreSentinel", () => {
  it("watches the sentinel with a margin of a screen below", () => {
    render(<MoreSentinel {...IDLE} onLoadMore={() => {}} />);
    expect(FakeObserver.live).toHaveLength(1);
    expect(FakeObserver.live[0]!.observed).toEqual([
      document.querySelector("[data-slot='more-sentinel']"),
    ]);
    expect(FakeObserver.live[0]!.options?.rootMargin).toBe("600px 0px");
  });

  it("asks for the next page when the sentinel comes near, on a phone", () => {
    const onLoadMore = vi.fn();
    render(<MoreSentinel {...IDLE} onLoadMore={onLoadMore} />);
    act(() => FakeObserver.live[0]!.report(false));
    expect(onLoadMore).not.toHaveBeenCalled();
    act(() => FakeObserver.live[0]!.report(true));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("never asks from 1024 px: the width is asked each time it fires, so a window widened later stops it", () => {
    const onLoadMore = vi.fn();
    render(<MoreSentinel {...IDLE} onLoadMore={onLoadMore} />);
    desktop = true;
    act(() => FakeObserver.live[0]!.report(true));
    expect(onLoadMore).not.toHaveBeenCalled();
    desktop = false;
    act(() => FakeObserver.live[0]!.report(true));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["there is no next page", { hasNextPage: false }],
    ["a page is on its way", { loading: true }],
    ["it is paused", { paused: true }],
  ])("does not watch while %s", (_name, override) => {
    render(<MoreSentinel {...IDLE} {...override} onLoadMore={() => {}} />);
    expect(FakeObserver.live).toHaveLength(0);
  });

  it("watches again when it can ask again: an observer reports only a change, and a short page leaves the sentinel in view", () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(<MoreSentinel {...IDLE} onLoadMore={onLoadMore} />);
    act(() => FakeObserver.live[0]!.report(true));
    rerender(<MoreSentinel {...IDLE} loading onLoadMore={onLoadMore} />);
    expect(FakeObserver.live).toHaveLength(0);
    rerender(<MoreSentinel {...IDLE} onLoadMore={onLoadMore} />);
    expect(FakeObserver.live).toHaveLength(1);
    act(() => FakeObserver.live[0]!.report(true));
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it("uses the latest callback without making the observer again", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<MoreSentinel {...IDLE} onLoadMore={first} />);
    rerender(<MoreSentinel {...IDLE} onLoadMore={second} />);
    expect(FakeObserver.all).toHaveLength(1);
    act(() => FakeObserver.live[0]!.report(true));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("lets go of the observer when it leaves", () => {
    const { unmount } = render(<MoreSentinel {...IDLE} onLoadMore={() => {}} />);
    unmount();
    expect(FakeObserver.live).toHaveLength(0);
  });

  it("does not break where there is no IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    expect(() => render(<MoreSentinel {...IDLE} onLoadMore={() => {}} />)).not.toThrow();
  });

  it("is a status that is empty until the page loads, then says 'Cargando más movimientos'", () => {
    const { rerender } = render(<MoreSentinel {...IDLE} onLoadMore={() => {}} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");
    expect(status.className).toContain("min-h-12");
    rerender(<MoreSentinel {...IDLE} loading onLoadMore={() => {}} />);
    expect(screen.getByRole("status").textContent).toBe("Cargando más movimientos");
    expect(screen.getByRole("status")).toBe(status);
  });

  it("takes the class the screen gives it", () => {
    render(<MoreSentinel {...IDLE} onLoadMore={() => {}} className="lg:hidden" />);
    expect(screen.getByRole("status").className).toContain("lg:hidden");
  });
});

describe("NextPageError", () => {
  it("says the next page failed, with the error in Spanish and a way to try again", () => {
    const onRetry = vi.fn();
    render(
      <NextPageError error={new TypeError("Failed to fetch")} onRetry={onRetry} busy={false} />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("No se pudieron cargar más movimientos")).toBeTruthy();
    expect(screen.getByText(/conexión/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("is busy while it asks again, so it is not asked twice", () => {
    const onRetry = vi.fn();
    render(<NextPageError error={new ApiError(500, undefined)} onRetry={onRetry} busy />);
    const button = screen.getByRole("button", { name: "Reintentar" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("never shows the English detail of the backend", () => {
    render(
      <NextPageError
        error={
          new ApiError(422, {
            detail: [{ type: "cursor_invalid", loc: ["query", "cursor"], msg: "Invalid cursor" }],
          })
        }
        onRetry={() => {}}
        busy={false}
      />,
    );
    expect(screen.getByRole("alert").textContent).not.toContain("Invalid cursor");
    expect(screen.getByRole("alert").textContent).toContain("desde el principio");
  });
});

import { act, cleanup, renderHook } from "@testing-library/react";
import type { KeyboardEvent } from "react";
import type { MouseHandlerDataParam } from "recharts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHART_TOOLTIP_SELECTOR, useDismissibleTooltip } from "./use-dismissible-tooltip";

// The hook on its own, without Recharts: what it needs from the chart is only "the tooltip is
// showing, at month n" (`onShownChange("2")`, which the card reports when it mounts), "the pointer is
// on month n" (the chart's `onMouseMove`, called by hand here) and the key listener on `document`.
// The chart tests hover a real chart (with a size given to it, jsdom has no layout).
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The `keydown` listeners that were added to or removed from `document`. */
function spyOnKeydownListeners() {
  const add = vi.spyOn(document, "addEventListener");
  const remove = vi.spyOn(document, "removeEventListener");
  return {
    added: () => add.mock.calls.filter(([type]) => type === "keydown").map(([, fn]) => fn),
    removed: () => remove.mock.calls.filter(([type]) => type === "keydown").map(([, fn]) => fn),
  };
}

function press(key: string, target: EventTarget = document.body) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe("the Escape on document, for a tooltip opened with the mouse", () => {
  it("is not listened for while no tooltip is showing", () => {
    const listeners = spyOnKeydownListeners();
    const { result } = renderHook(() => useDismissibleTooltip());
    expect(listeners.added()).toHaveLength(0);

    press("Escape");
    expect(result.current.active).toBeUndefined();
  });

  it("hides the tooltip when Escape is pressed anywhere, and stops listening once it is gone", () => {
    const listeners = spyOnKeydownListeners();
    const { result } = renderHook(() => useDismissibleTooltip());

    act(() => result.current.onShownChange("2"));
    expect(listeners.added()).toHaveLength(1);
    expect(listeners.removed()).toHaveLength(0);

    press("Escape");
    expect(result.current.active).toBe(false);

    // The card unmounts because the tooltip is hidden: it reports it, and the listener goes.
    act(() => result.current.onShownChange(null));
    expect(listeners.removed()).toEqual(listeners.added());
  });

  it("removes the listener when the tooltip goes away by itself (the mouse left the chart)", () => {
    const listeners = spyOnKeydownListeners();
    const { result } = renderHook(() => useDismissibleTooltip());
    act(() => result.current.onShownChange("2"));
    act(() => result.current.onShownChange(null));
    expect(listeners.removed()).toEqual(listeners.added());

    press("Escape");
    expect(result.current.active).toBeUndefined();
  });

  it("removes the listener when the chart unmounts with the tooltip showing", () => {
    const listeners = spyOnKeydownListeners();
    const { result, unmount } = renderHook(() => useDismissibleTooltip());
    act(() => result.current.onShownChange("2"));
    expect(listeners.added()).toHaveLength(1);

    unmount();
    expect(listeners.removed()).toEqual(listeners.added());
    // Nothing listens any more: an Escape now reaches no handler of the hook.
    expect(() => press("Escape")).not.toThrow();
  });

  it("does not swallow the Escape: whatever else listens for it still hears it", () => {
    const { result } = renderHook(() => useDismissibleTooltip());
    act(() => result.current.onShownChange("2"));
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);

    const event = press("Escape");
    window.removeEventListener("keydown", onWindow);
    expect(event.defaultPrevented).toBe(false);
    expect(onWindow).toHaveBeenCalledTimes(1);
  });

  it("ignores every other key", () => {
    const { result } = renderHook(() => useDismissibleTooltip());
    act(() => result.current.onShownChange("2"));
    for (const key of ["Enter", "Tab", "ArrowRight", " ", "Esc", "a"]) press(key);
    expect(result.current.active).toBeUndefined();
  });

  it("remounts the Recharts tooltip (a new `resetKey`) each time it comes back, and only then", () => {
    const { result } = renderHook(() => useDismissibleTooltip());
    const arrow = { key: "ArrowRight" } as KeyboardEvent<HTMLElement>;
    expect(result.current.resetKey).toBe(0);

    // An arrow with nothing dismissed brings nothing back, so nothing is remounted.
    act(() => result.current.containerProps.onKeyDown(arrow));
    expect(result.current.resetKey).toBe(0);

    act(() => result.current.onShownChange("2"));
    press("Escape");
    expect(result.current.resetKey).toBe(0);
    act(() => result.current.containerProps.onKeyDown(arrow));
    expect(result.current.resetKey).toBe(1);

    // A second arrow finds nothing dismissed any more.
    act(() => result.current.containerProps.onKeyDown(arrow));
    expect(result.current.resetKey).toBe(1);
  });

  it("shows the tooltip again with an arrow", () => {
    const { result } = renderHook(() => useDismissibleTooltip());
    act(() => result.current.onShownChange("2"));

    press("Escape");
    expect(result.current.active).toBe(false);
    const arrow = { key: "ArrowLeft" } as KeyboardEvent<HTMLElement>;
    act(() => result.current.containerProps.onKeyDown(arrow));
    expect(result.current.active).toBeUndefined();
  });
});

describe("what the mouse does after an Escape", () => {
  /** What the chart's `onMouseMove` hands over: the month under the pointer, if there is one. */
  const over = (index: number | string | undefined) =>
    ({ activeTooltipIndex: index }) as unknown as MouseHandlerDataParam;

  function dismissedAt(index: string) {
    const hook = renderHook(() => useDismissibleTooltip());
    act(() => hook.result.current.onShownChange(index));
    press("Escape");
    expect(hook.result.current.active).toBe(false);
    return hook;
  }

  it("does nothing when the tooltip is not dismissed", () => {
    const { result } = renderHook(() => useDismissibleTooltip());
    act(() => result.current.chartProps.onMouseMove(over(1)));
    expect(result.current.active).toBeUndefined();
  });

  it("keeps it hidden while the pointer stays on the month that was showing, however much it moves", () => {
    const { result } = dismissedAt("2");
    for (const index of [2, "2", 2]) {
      act(() => result.current.chartProps.onMouseMove(over(index)));
      expect(result.current.active).toBe(false);
    }
  });

  it("shows it again as soon as the pointer is on another month", () => {
    const { result } = dismissedAt("2");
    act(() => result.current.chartProps.onMouseMove(over(3)));
    expect(result.current.active).toBeUndefined();
  });

  it("does nothing over the padding of the chart, where there is no month under the pointer", () => {
    const { result } = dismissedAt("2");
    act(() => result.current.chartProps.onMouseMove(over(undefined)));
    expect(result.current.active).toBe(false);
  });

  it("forgets the month when the pointer leaves, so coming back over any month, the same one too, shows it", () => {
    const { result } = dismissedAt("2");
    // Leaving alone shows nothing.
    act(() => result.current.containerProps.onMouseLeave());
    expect(result.current.active).toBe(false);

    act(() => result.current.chartProps.onMouseMove(over(2)));
    expect(result.current.active).toBeUndefined();
  });

  it("keeps the month of the last Escape: closing it again somewhere else remembers the new one", () => {
    const hook = renderHook(() => useDismissibleTooltip());
    act(() => hook.result.current.onShownChange("1"));
    press("Escape");
    act(() => hook.result.current.chartProps.onMouseMove(over(4)));
    expect(hook.result.current.active).toBeUndefined();

    // The tooltip is showing on month 4 now (the card reports it) and Escape closes that one.
    act(() => hook.result.current.onShownChange("4"));
    press("Escape");
    expect(hook.result.current.active).toBe(false);
    act(() => hook.result.current.chartProps.onMouseMove(over(4)));
    expect(hook.result.current.active).toBe(false);
    act(() => hook.result.current.chartProps.onMouseMove(over(1)));
    expect(hook.result.current.active).toBeUndefined();
  });

  it("remembers the month shown by the keyboard too: the Escape from inside the chart", () => {
    const { result } = renderHook(() => useDismissibleTooltip());
    act(() => result.current.onShownChange("3"));
    const tooltip = document.createElement("div");
    tooltip.innerHTML = '<div data-slot="chart-tooltip"></div>';
    const escape = {
      key: "Escape",
      currentTarget: tooltip,
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent<HTMLElement>;
    act(() => result.current.containerProps.onKeyDown(escape));
    expect(result.current.active).toBe(false);

    act(() => result.current.chartProps.onMouseMove(over(3)));
    expect(result.current.active).toBe(false);
    act(() => result.current.chartProps.onMouseMove(over(0)));
    expect(result.current.active).toBeUndefined();
  });
});

describe("the Escape on the container, for a chart with the focus", () => {
  function keyEvent(key: string, container: HTMLElement) {
    return {
      key,
      currentTarget: container,
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent<HTMLElement> & { stopPropagation: ReturnType<typeof vi.fn> };
  }

  it("hides the tooltip and swallows the key only if one is showing", () => {
    const { result } = renderHook(() => useDismissibleTooltip());
    const withTooltip = document.createElement("div");
    withTooltip.innerHTML = '<div data-slot="chart-tooltip"></div>';
    expect(withTooltip.querySelector(CHART_TOOLTIP_SELECTOR)).not.toBeNull();

    const nothing = keyEvent("Escape", document.createElement("div"));
    act(() => result.current.containerProps.onKeyDown(nothing));
    expect(nothing.stopPropagation).not.toHaveBeenCalled();
    expect(result.current.active).toBeUndefined();

    const closing = keyEvent("Escape", withTooltip);
    act(() => result.current.containerProps.onKeyDown(closing));
    expect(closing.stopPropagation).toHaveBeenCalledTimes(1);
    expect(result.current.active).toBe(false);
  });

  it("leaves Tab and the other keys alone", () => {
    const { result } = renderHook(() => useDismissibleTooltip());
    for (const key of ["Tab", "Enter", "Home", "a"]) {
      const event = keyEvent(key, document.createElement("div"));
      act(() => result.current.containerProps.onKeyDown(event));
      expect(event.stopPropagation).not.toHaveBeenCalled();
    }
    expect(result.current.active).toBeUndefined();
  });
});

import { act, cleanup, renderHook } from "@testing-library/react";
import type { KeyboardEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHART_TOOLTIP_SELECTOR, useDismissibleTooltip } from "./use-dismissible-tooltip";

// The hook on its own: jsdom gives no layout, so a chart cannot be hovered there, and what the
// hover case needs is only "the tooltip is showing" (`onShownChange(true)`, which the card reports
// when it mounts), the key listener on `document` and what it does to `active`.
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

    act(() => result.current.onShownChange(true));
    expect(listeners.added()).toHaveLength(1);
    expect(listeners.removed()).toHaveLength(0);

    press("Escape");
    expect(result.current.active).toBe(false);

    // The card unmounts because the tooltip is hidden: it reports it, and the listener goes.
    act(() => result.current.onShownChange(false));
    expect(listeners.removed()).toEqual(listeners.added());
  });

  it("removes the listener when the tooltip goes away by itself (the mouse left the chart)", () => {
    const listeners = spyOnKeydownListeners();
    const { result } = renderHook(() => useDismissibleTooltip());
    act(() => result.current.onShownChange(true));
    act(() => result.current.onShownChange(false));
    expect(listeners.removed()).toEqual(listeners.added());

    press("Escape");
    expect(result.current.active).toBeUndefined();
  });

  it("removes the listener when the chart unmounts with the tooltip showing", () => {
    const listeners = spyOnKeydownListeners();
    const { result, unmount } = renderHook(() => useDismissibleTooltip());
    act(() => result.current.onShownChange(true));
    expect(listeners.added()).toHaveLength(1);

    unmount();
    expect(listeners.removed()).toEqual(listeners.added());
    // Nothing listens any more: an Escape now reaches no handler of the hook.
    expect(() => press("Escape")).not.toThrow();
  });

  it("does not swallow the Escape: whatever else listens for it still hears it", () => {
    const { result } = renderHook(() => useDismissibleTooltip());
    act(() => result.current.onShownChange(true));
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);

    const event = press("Escape");
    window.removeEventListener("keydown", onWindow);
    expect(event.defaultPrevented).toBe(false);
    expect(onWindow).toHaveBeenCalledTimes(1);
  });

  it("ignores every other key", () => {
    const { result } = renderHook(() => useDismissibleTooltip());
    act(() => result.current.onShownChange(true));
    for (const key of ["Enter", "Tab", "ArrowRight", " ", "Esc", "a"]) press(key);
    expect(result.current.active).toBeUndefined();
  });

  it("shows the tooltip again with an arrow or a mouse move", () => {
    const { result } = renderHook(() => useDismissibleTooltip());
    act(() => result.current.onShownChange(true));

    press("Escape");
    expect(result.current.active).toBe(false);
    act(() => result.current.containerProps.onMouseMove());
    expect(result.current.active).toBeUndefined();

    press("Escape");
    expect(result.current.active).toBe(false);
    const arrow = { key: "ArrowLeft" } as KeyboardEvent<HTMLElement>;
    act(() => result.current.containerProps.onKeyDown(arrow));
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

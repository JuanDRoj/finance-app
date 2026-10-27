import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_KEYBOARD_INSET, useKeyboardInset } from "./use-keyboard-inset";

// jsdom has no Visual Viewport: an EventTarget with the three numbers the hook reads stands in.
class FakeViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  set(height: number, offsetTop = 0) {
    this.height = height;
    this.offsetTop = offsetTop;
    this.dispatchEvent(new Event("resize"));
  }
}

let viewport: FakeViewport;

function install(value: FakeViewport | undefined) {
  Object.defineProperty(window, "visualViewport", { value, configurable: true });
}

beforeEach(() => {
  viewport = new FakeViewport();
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true, writable: true });
  install(viewport);
});

afterEach(() => {
  cleanup();
  install(undefined);
});

function Probe({ active = true }: { active?: boolean }) {
  return <output data-testid="inset">{useKeyboardInset(active)}</output>;
}

const inset = () => screen.getByTestId("inset").textContent;

describe("useKeyboardInset", () => {
  it("is 0 while the keyboard is closed", () => {
    render(<Probe />);
    expect(inset()).toBe("0");
  });

  it("is how much the keyboard covers: the page height minus the visible height", () => {
    render(<Probe />);
    act(() => viewport.set(500));
    expect(inset()).toBe("300");
  });

  it("subtracts how far the visible area is scrolled down (iOS scrolls the page up)", () => {
    render(<Probe />);
    act(() => viewport.set(500, 120));
    expect(inset()).toBe("180");
  });

  it("goes back to 0 when the keyboard closes", () => {
    render(<Probe />);
    act(() => viewport.set(450));
    expect(inset()).toBe("350");
    act(() => viewport.set(800));
    expect(inset()).toBe("0");
  });

  it("follows the scroll of the visual viewport too", () => {
    render(<Probe />);
    act(() => {
      viewport.height = 500;
      viewport.offsetTop = 0;
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(inset()).toBe("300");
  });

  it("is 0 for a difference smaller than any keyboard: the browser's own bars", () => {
    render(<Probe />);
    act(() => viewport.set(800 - (MIN_KEYBOARD_INSET - 1)));
    expect(inset()).toBe("0");
    act(() => viewport.set(800 - MIN_KEYBOARD_INSET));
    expect(inset()).toBe(String(MIN_KEYBOARD_INSET));
  });

  it("is 0 where the page already shrinks with the keyboard (Android), and so is the difference", () => {
    render(<Probe />);
    // The layout viewport shrinks together with the visual one.
    act(() => {
      Object.defineProperty(window, "innerHeight", { value: 500, configurable: true });
      viewport.set(500);
    });
    expect(inset()).toBe("0");
  });

  it("is 0 while not active, even with the keyboard open (the side panel, a closed sheet)", () => {
    const { rerender } = render(<Probe active={false} />);
    act(() => viewport.set(500));
    expect(inset()).toBe("0");
    rerender(<Probe active />);
    expect(inset()).toBe("300");
  });

  it("is 0 where the API does not exist", () => {
    install(undefined);
    render(<Probe />);
    expect(inset()).toBe("0");
  });

  it("stops listening when it unmounts", () => {
    const remove = vi.spyOn(viewport, "removeEventListener");
    const { unmount } = render(<Probe />);
    unmount();
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
  });
});

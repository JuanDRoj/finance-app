import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BfcacheGuard, markSessionEnded, SESSION_ENDED_ATTRIBUTE } from "./bfcache-guard";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute(SESSION_ENDED_ATTRIBUTE);
});

const reload = vi.fn();

beforeEach(() => {
  reload.mockReset();
  vi.stubGlobal("location", { ...window.location, reload });
});

/** What the browser fires when a page is shown: `persisted` is true when it comes back from the
 * back/forward cache, frozen as it was left. */
function pageshow(persisted: boolean) {
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted }));
}

describe("BfcacheGuard", () => {
  it("reloads a page that the browser restores from its back/forward cache", () => {
    render(<BfcacheGuard />);
    pageshow(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does nothing on a normal load", () => {
    render(<BfcacheGuard />);
    pageshow(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("stops listening when it unmounts", () => {
    const { unmount } = render(<BfcacheGuard />);
    unmount();
    pageshow(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it("renders nothing", () => {
    const { container } = render(<BfcacheGuard />);
    expect(container.innerHTML).toBe("");
  });
});

describe("markSessionEnded", () => {
  it("marks <html>, which globals.css uses to hide the page", () => {
    expect(document.documentElement.hasAttribute(SESSION_ENDED_ATTRIBUTE)).toBe(false);
    markSessionEnded();
    expect(document.documentElement.getAttribute(SESSION_ENDED_ATTRIBUTE)).toBe("true");
  });
});

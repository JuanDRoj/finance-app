import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopRedirect } from "./desktop-redirect";

const mocks = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));

const DESKTOP_QUERY = "(min-width: 64rem)";

/** A `matchMedia` for jsdom (which has none) where only the desktop query can match. */
function stubMatchMedia(initiallyDesktop: boolean) {
  let desktop = initiallyDesktop;
  const listeners = new Set<(event: { matches: boolean }) => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    media: query,
    get matches() {
      return query === DESKTOP_QUERY && desktop;
    },
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => {
      if (query === DESKTOP_QUERY) listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => {
      if (query === DESKTOP_QUERY) listeners.delete(listener);
    },
  }));
  return {
    resize(toDesktop: boolean) {
      desktop = toDesktop;
      for (const listener of listeners) listener({ matches: toDesktop });
    },
  };
}

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  mocks.replace.mockReset();
});

describe("DesktopRedirect", () => {
  it("draws nothing", () => {
    stubMatchMedia(false);
    const { container } = render(<DesktopRedirect />);
    expect(container.innerHTML).toBe("");
  });

  it("leaves a phone or a tablet where it is", () => {
    stubMatchMedia(false);
    render(<DesktopRedirect />);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("replaces the screen with / from 1024 px (not push: 'atrás' must not come back)", () => {
    stubMatchMedia(true);
    render(<DesktopRedirect />);
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith("/");
  });

  it("goes where it is told", () => {
    stubMatchMedia(true);
    render(<DesktopRedirect to="/cuentas" />);
    expect(mocks.replace).toHaveBeenCalledWith("/cuentas");
  });

  it("redirects when the window grows past 1024 px (a tablet turned sideways)", () => {
    const media = stubMatchMedia(false);
    render(<DesktopRedirect />);
    expect(mocks.replace).not.toHaveBeenCalled();

    act(() => media.resize(true));
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith("/");
  });
});

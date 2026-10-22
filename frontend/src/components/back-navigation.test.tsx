import { afterEach, describe, expect, it, vi } from "vitest";
import { canGoBackInApp } from "./back-navigation";

afterEach(() => vi.restoreAllMocks());

/** The page was reached from `referrer`, with a history of `length` entries. */
function arrivedFrom(referrer: string, length: number) {
  vi.spyOn(document, "referrer", "get").mockReturnValue(referrer);
  vi.spyOn(window.history, "length", "get").mockReturnValue(length);
}

describe("canGoBackInApp", () => {
  it("is true when the visitor came from a page of this same origin and there is history", () => {
    arrivedFrom(`${window.location.origin}/`, 3);
    expect(canGoBackInApp()).toBe(true);
    arrivedFrom(`${window.location.origin}/movimientos?mes=2026-10`, 2);
    expect(canGoBackInApp()).toBe(true);
  });

  it("is false when the page was opened directly: there is no referrer", () => {
    arrivedFrom("", 3);
    expect(canGoBackInApp()).toBe(false);
  });

  it("is false when the visitor came from another site", () => {
    arrivedFrom("https://example.com/algo", 3);
    expect(canGoBackInApp()).toBe(false);
  });

  it("is false in a new tab: one entry in the history, nothing to go back to", () => {
    arrivedFrom(`${window.location.origin}/`, 1);
    expect(canGoBackInApp()).toBe(false);
  });

  it("compares the origin exactly: a host that merely starts the same is another site", () => {
    arrivedFrom(`${window.location.origin}.evil.example/`, 3);
    expect(canGoBackInApp()).toBe(false);
    arrivedFrom(`${window.location.origin}@evil.example/`, 3);
    expect(canGoBackInApp()).toBe(false);
  });

  it("is false when the referrer is not a URL", () => {
    arrivedFrom("not a url", 3);
    expect(canGoBackInApp()).toBe(false);
  });
});

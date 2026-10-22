import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackLink } from "./back-link";

const mocks = vi.hoisted(() => ({ back: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: mocks.back }) }));
vi.mock("next/link", () => ({
  default: ({ prefetch, ...props }: ComponentProps<"a"> & { prefetch?: boolean }) => (
    <a data-prefetch={String(prefetch)} {...props} />
  ),
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => mocks.back.mockReset());

/** The page was reached from `referrer`, with a history of `length` entries. */
function arrivedFrom(referrer: string, length: number) {
  vi.spyOn(document, "referrer", "get").mockReturnValue(referrer);
  vi.spyOn(window.history, "length", "get").mockReturnValue(length);
}

/** Clicks and says whether the browser would still have followed the link. */
function click() {
  let followed = false;
  const listener = (event: Event) => {
    followed = !event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener("click", listener);
  fireEvent.click(screen.getByRole("link", { name: "Volver" }));
  document.removeEventListener("click", listener);
  return followed;
}

describe("BackLink", () => {
  it("is a link named 'Volver', with an icon that is not read, 44 px", () => {
    render(<BackLink />);
    const link = screen.getByRole("link", { name: "Volver" });
    expect(link.textContent).toBe("");
    expect(link.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(link.className).toContain("size-11");
  });

  it("goes to the Inicio by default, and to the fallback it is given", () => {
    const { unmount } = render(<BackLink />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/");
    unmount();
    render(<BackLink fallbackHref="/cuentas" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/cuentas");
  });

  it("goes back in the history when the visitor came from this app", () => {
    arrivedFrom(`${window.location.origin}/`, 3);
    render(<BackLink />);
    expect(click()).toBe(false);
    expect(mocks.back).toHaveBeenCalledTimes(1);
  });

  it("follows the link when the page was opened from elsewhere", () => {
    arrivedFrom("https://example.com/algo", 3);
    render(<BackLink />);
    expect(click()).toBe(true);
    expect(mocks.back).not.toHaveBeenCalled();
  });

  it("follows the link when the page was opened directly (no referrer)", () => {
    arrivedFrom("", 3);
    render(<BackLink />);
    expect(click()).toBe(true);
    expect(mocks.back).not.toHaveBeenCalled();
  });

  it("follows the link in a new tab: nothing to go back to there", () => {
    arrivedFrom(`${window.location.origin}/`, 1);
    render(<BackLink />);
    expect(click()).toBe(true);
    expect(mocks.back).not.toHaveBeenCalled();
  });

  it("is not fooled by an origin that merely starts the same", () => {
    arrivedFrom(`${window.location.origin}.evil.example/`, 3);
    render(<BackLink />);
    expect(click()).toBe(true);
    expect(mocks.back).not.toHaveBeenCalled();
  });

  it("follows the link if the referrer is not a URL", () => {
    arrivedFrom("not a url", 3);
    render(<BackLink />);
    expect(click()).toBe(true);
  });
});

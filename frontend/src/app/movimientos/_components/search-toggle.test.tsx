import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_SEARCH_INPUT_ID } from "./search-box";
import { setSearchOpen, useSearchOpen } from "./search-open-store";
import { SearchToggle } from "./search-toggle";

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
  setSearchOpen(false);
  window.history.replaceState = replaceState;
  replaceState(null, "", "/");
});

/** The toggle and a stand-in for the field that the screen draws when the search is open. */
function Harness() {
  const open = useSearchOpen();
  return (
    <>
      <SearchToggle currentMonth="2026-10" />
      {open ? <input id={PHONE_SEARCH_INPUT_ID} aria-label="campo" /> : null}
    </>
  );
}

const toggle = () => screen.getByRole("button", { name: "Buscar" });

describe("SearchToggle", () => {
  it("is a button of 44 px named 'Buscar', closed at first, for a phone only", () => {
    render(<SearchToggle currentMonth="2026-10" />);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().className).toContain("size-11");
    expect(toggle().className).toContain("lg:hidden");
    expect(toggle().querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("opens the field and puts the focus in it in the same tap", () => {
    render(<Harness />);
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(screen.getByLabelText("campo"));
  });

  it("keeps its name when it is open: it is a disclosure, aria-expanded says the state", () => {
    render(<Harness />);
    fireEvent.click(toggle());
    // No verb in the name ("Abrir…" would be wrong once the same tap closes it).
    expect(screen.getByRole("button", { name: "Buscar" })).toBe(toggle());
    expect(toggle().getAttribute("aria-label")).toBe("Buscar");
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-label")).toBe("Buscar");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });

  it("is primary while it is open", () => {
    render(<Harness />);
    fireEvent.click(toggle());
    expect(toggle().className).toContain("bg-primary");
    expect(toggle().className).toContain("text-primary-foreground");
  });

  it("is open when the URL brings a search, with the store closed", () => {
    replaceState(null, "", "/movimientos?q=uber");
    render(<SearchToggle currentMonth="2026-10" />);
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("closes the field and clears the search of the URL, keeping the rest", () => {
    replaceState(null, "", "/movimientos?mes=2026-09&q=uber&tipo=gastos");
    render(<Harness />);
    fireEvent.click(toggle());
    expect(window.location.search).toBe("?mes=2026-09&tipo=gastos");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("campo")).toBeNull();
  });

  it("closes a field that was opened with the magnifier and has no search yet", () => {
    render(<Harness />);
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("campo")).toBeNull();
    act(() => {});
  });
});

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEARCH_DEBOUNCE_MS, SearchBox } from "./search-box";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
});

function setup(variant: "phone" | "desktop" = "desktop", value: string | undefined = undefined) {
  const onCommit = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <SearchBox value={value} onCommit={onCommit} variant={variant} onClose={onClose} />,
  );
  const input = screen.getByRole("searchbox", {
    name: "Buscar por descripción",
  }) as HTMLInputElement;
  const type = (text: string) => fireEvent.change(input, { target: { value: text } });
  const rerender = (next: string | undefined) =>
    view.rerender(
      <SearchBox value={next} onCommit={onCommit} variant={variant} onClose={onClose} />,
    );
  return { onCommit, onClose, input, type, rerender };
}

const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe("the debounce", () => {
  it("searches 350 ms after the last key, not before", async () => {
    const { onCommit, type } = setup();
    type("u");
    await wait(SEARCH_DEBOUNCE_MS - 1);
    expect(onCommit).not.toHaveBeenCalled();
    await wait(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("u");
  });

  it("restarts the wait with every key and searches once, for the whole text", async () => {
    const { onCommit, type } = setup();
    type("u");
    await wait(200);
    type("ub");
    await wait(200);
    type("uber");
    await wait(349);
    expect(onCommit).not.toHaveBeenCalled();
    await wait(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("uber");
  });

  it("does not search for what the URL already says", async () => {
    const { onCommit, type } = setup("desktop", "uber");
    type("uber");
    await wait(1000);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("searches without the spaces at the ends", async () => {
    const { onCommit, type } = setup();
    type("  café  ");
    await wait(SEARCH_DEBOUNCE_MS);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith("café");
  });

  it("takes a text of spaces for no search: nothing is written when there was none", async () => {
    const { onCommit, type } = setup();
    type("   ");
    await wait(SEARCH_DEBOUNCE_MS);
    type("\u00A0\u2003");
    await wait(SEARCH_DEBOUNCE_MS);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("clears a search that was written when the text is turned into spaces", async () => {
    const { onCommit, type } = setup();
    type("café");
    await wait(SEARCH_DEBOUNCE_MS);
    type("   ");
    await wait(SEARCH_DEBOUNCE_MS);
    expect(onCommit.mock.calls.map(([q]) => q)).toEqual(["café", undefined]);
  });

  it("clears the search when the text is erased", async () => {
    const { onCommit, type, rerender } = setup("desktop", "uber");
    type("");
    await wait(SEARCH_DEBOUNCE_MS);
    expect(onCommit).toHaveBeenCalledWith(undefined);
    rerender(undefined);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("cuts a text of more than 100 characters to 100", async () => {
    const { onCommit, type } = setup();
    type("x".repeat(150));
    await wait(SEARCH_DEBOUNCE_MS);
    expect(onCommit).toHaveBeenCalledWith("x".repeat(100));
  });

  it("counts a search of 100 emoji as 100 characters, the way the backend does", async () => {
    const { onCommit, type, input } = setup();
    expect(input.maxLength).toBe(100);
    type("😀".repeat(100));
    await wait(SEARCH_DEBOUNCE_MS);
    expect([...(onCommit.mock.calls[0]![0] as string)]).toHaveLength(100);
  });
});

describe("Enter", () => {
  it("searches at once and cancels the wait", async () => {
    const { onCommit, type, input } = setup();
    type("uber");
    fireEvent.submit(input.closest("form")!);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("uber");
    await wait(1000);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the text is the one the URL has", () => {
    const { onCommit, input } = setup("desktop", "uber");
    fireEvent.submit(input.closest("form")!);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("closes the keyboard on a phone, and keeps the focus on desktop", () => {
    const phone = setup("phone");
    phone.input.focus();
    phone.type("uber");
    fireEvent.submit(phone.input.closest("form")!);
    expect(document.activeElement).not.toBe(phone.input);
    cleanup();
    const desktop = setup("desktop");
    desktop.input.focus();
    desktop.type("uber");
    fireEvent.submit(desktop.input.closest("form")!);
    expect(document.activeElement).toBe(desktop.input);
  });
});

describe("an IME composing", () => {
  it("does not search in the middle of a composition, and does after it", async () => {
    const { onCommit, type, input } = setup();
    fireEvent.compositionStart(input);
    type("に");
    await wait(2000);
    expect(onCommit).not.toHaveBeenCalled();
    type("にほん");
    fireEvent.compositionEnd(input, { data: "にほん" });
    await wait(SEARCH_DEBOUNCE_MS);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("にほん");
  });

  it("does not take Enter, which confirms the composition, for a search", () => {
    const { onCommit, type, input } = setup();
    fireEvent.compositionStart(input);
    type("に");
    fireEvent.submit(input.closest("form")!);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("the field and the URL", () => {
  it("shows the search of the URL", () => {
    const { input } = setup("desktop", "uber");
    expect(input.value).toBe("uber");
  });

  it("adopts a change that comes from elsewhere ('Quitar filtros', a link, back and forward)", () => {
    const { input, rerender, onCommit } = setup("desktop", "uber");
    rerender(undefined);
    expect(input.value).toBe("");
    rerender("café");
    expect(input.value).toBe("café");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("keeps what the person typed when the URL gives back what the box wrote", async () => {
    const { input, type, rerender } = setup();
    type("uber");
    await wait(SEARCH_DEBOUNCE_MS);
    // The person goes on typing before the URL answers...
    type("uber e");
    // ...and then the answer to the first write arrives.
    rerender("uber");
    expect(input.value).toBe("uber e");
  });

  it("does not undo a space typed at the end: 'uber ' stays 'uber ' while the URL says 'uber'", async () => {
    const { input, type, rerender } = setup();
    type("uber ");
    await wait(SEARCH_DEBOUNCE_MS);
    rerender("uber");
    expect(input.value).toBe("uber ");
  });

  it("survives two writes in a row whose answers come back one by one", async () => {
    const { input, type, rerender, onCommit } = setup();
    type("a");
    await wait(SEARCH_DEBOUNCE_MS);
    type("ab");
    await wait(SEARCH_DEBOUNCE_MS);
    expect(onCommit.mock.calls.map(([q]) => q)).toEqual(["a", "ab"]);
    rerender("a");
    expect(input.value).toBe("ab");
    rerender("ab");
    expect(input.value).toBe("ab");
  });

  it("takes an outside change even after the box has written something", async () => {
    const { input, type, rerender } = setup();
    type("uber");
    await wait(SEARCH_DEBOUNCE_MS);
    rerender("uber");
    rerender(undefined);
    expect(input.value).toBe("");
  });
});

describe("the field", () => {
  it("is a search box with the keyboard of a search: Buscar, no capitals, no autocorrect, 16 px", () => {
    const { input } = setup();
    expect(input.type).toBe("search");
    expect(input.getAttribute("enterkeyhint")).toBe("search");
    expect(input.getAttribute("inputmode")).toBe("search");
    expect(input.getAttribute("autocapitalize")).toBe("none");
    expect(input.getAttribute("autocorrect")).toBe("off");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(input.placeholder).toBe("Buscar por descripción");
    expect(input.className).toContain("text-base");
  });

  it("is a search landmark, and its slot is the one the CSS rule of the bottom bar names", () => {
    const { input } = setup();
    const form = screen.getByRole("search", { name: "Buscar movimientos" });
    expect(form.getAttribute("data-slot")).toBe("movement-search");
    expect(form.contains(input)).toBe(true);
  });

  it("is a pill of 48 px with 'Cerrar la búsqueda' on a phone", () => {
    const { input, onClose } = setup("phone");
    expect(input.className).toContain("h-12");
    expect(input.className).toContain("rounded-full");
    expect(input.className).toContain("[&::-webkit-search-cancel-button]:appearance-none");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar la búsqueda" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Cerrar la búsqueda" }).className).toContain(
      "size-11",
    );
  });

  it("is a pill of 42 px (44 for a finger) with no button of its own on desktop", () => {
    const { input } = setup("desktop");
    expect(input.className).toContain("h-10.5");
    expect(input.className).toContain("pointer-coarse:h-11");
    expect(input.className).not.toContain("webkit-search-cancel-button");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("has the magnifier inside, out of reach of speech and of the pointer", () => {
    setup();
    const icon = screen.getByRole("search").querySelector("svg")!;
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.getAttribute("class")).toContain("pointer-events-none");
  });

  it("gives the phone's field the id that the magnifier focuses, and not the desktop's", () => {
    const phone = setup("phone");
    expect(phone.input.id).toBe("movement-search-phone");
    cleanup();
    expect(setup("desktop").input.id).not.toBe("movement-search-phone");
  });
});

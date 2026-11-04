import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MovementLink, findMovementLink } from "./movement-link";
import { editMovementHref, parseMovementEditId } from "./movement-urls";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
  document.body.replaceChildren();
});

const ID = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0020";

describe("editMovementHref and parseMovementEditId", () => {
  it("is an address of Movimientos with the panel and the id, so a link works anywhere", () => {
    expect(editMovementHref(ID)).toBe(`/movimientos?movimiento=editar&id=${ID}`);
    expect(editMovementHref("a b&c")).toBe("/movimientos?movimiento=editar&id=a%20b%26c");
  });

  it("reads the id from the params only when it is a UUID, in lowercase", () => {
    expect(parseMovementEditId(new URLSearchParams(`movimiento=editar&id=${ID}`))).toBe(ID);
    expect(parseMovementEditId(new URLSearchParams(`id=${ID.toUpperCase()}`))).toBe(ID);
  });

  it("gives nothing for a missing id, an empty one or anything that is not a UUID (it would be a 422)", () => {
    for (const search of ["", "id=", "id=m1", "id=123", `id=${ID}x`, `id=%20${ID}`, "id=null"]) {
      expect(parseMovementEditId(new URLSearchParams(search))).toBeUndefined();
    }
  });
});

describe("MovementLink", () => {
  it("is a real link to the edit address, marked for the sheet to find it", () => {
    render(<MovementLink movementId={ID}>Uber</MovementLink>);
    const link = screen.getByRole("link", { name: "Uber" });
    expect(link.getAttribute("href")).toBe(editMovementHref(ID));
    expect(link.hasAttribute("data-movement-link")).toBe(true);
    expect(link.getAttribute("data-movement-id")).toBe(ID);
  });

  it("on a plain click opens the panel in the current address, keeping the rest, with no history entry", () => {
    window.history.replaceState(null, "", "/movimientos?mes=2026-09&tipo=gastos");
    const before = window.history.length;
    render(<MovementLink movementId={ID}>Uber</MovementLink>);
    const notPrevented = fireEvent.click(screen.getByRole("link"));
    expect(notPrevented).toBe(false);
    expect(window.location.pathname).toBe("/movimientos");
    expect(window.location.search).toBe(`?mes=2026-09&tipo=gastos&movimiento=editar&id=${ID}`);
    expect(window.history.length).toBe(before);
  });

  it("does the same below 1024 px: the sheet of a phone is the same URL, there is no page to go to", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    render(<MovementLink movementId={ID}>Uber</MovementLink>);
    fireEvent.click(screen.getByRole("link"));
    expect(window.location.search).toBe(`?movimiento=editar&id=${ID}`);
  });

  it("opening another movement replaces the id of the first", () => {
    window.history.replaceState(null, "", `/movimientos?movimiento=editar&id=${ID}`);
    const other = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0021";
    render(<MovementLink movementId={other}>Café</MovementLink>);
    fireEvent.click(screen.getByRole("link"));
    expect(window.location.search).toBe(`?movimiento=editar&id=${other}`);
  });

  it.each([["ctrlKey"], ["metaKey"], ["shiftKey"], ["altKey"]])(
    "with %s it keeps its meaning (a new tab): the address is not written",
    (modifier) => {
      render(<MovementLink movementId={ID}>Uber</MovementLink>);
      fireEvent.click(screen.getByRole("link"), { [modifier]: true });
      expect(window.location.search).toBe("");
    },
  );

  it("does not take the middle button", () => {
    render(<MovementLink movementId={ID}>Uber</MovementLink>);
    fireEvent.click(screen.getByRole("link"), { button: 1 });
    expect(window.location.search).toBe("");
  });

  it("passes its own props through: the name, the class and aria-haspopup", () => {
    render(
      <MovementLink movementId={ID} aria-label="Editar Uber" aria-haspopup="dialog" className="x">
        <svg />
      </MovementLink>,
    );
    const link = screen.getByRole("link", { name: "Editar Uber" });
    expect(link.getAttribute("aria-haspopup")).toBe("dialog");
    expect(link.className).toContain("x");
  });
});

describe("findMovementLink", () => {
  /** A link with or without a layout box (jsdom has none: say which one is on screen). */
  function twoLinks(visible: "first" | "second" | "none") {
    render(
      <>
        <MovementLink movementId={ID}>lista</MovementLink>
        <MovementLink movementId={ID}>tabla</MovementLink>
        <MovementLink movementId="otro">otro</MovementLink>
      </>,
    );
    const [first, second] = screen.getAllByRole("link");
    const box = [{} as DOMRect];
    first!.getClientRects = () =>
      visible === "first" ? (box as unknown as DOMRectList) : ([] as unknown as DOMRectList);
    second!.getClientRects = () =>
      visible === "second" ? (box as unknown as DOMRectList) : ([] as unknown as DOMRectList);
    return { first: first!, second: second! };
  }

  it("finds the link of the movement that is on screen when two are in the page", () => {
    const { first, second } = twoLinks("second");
    expect(findMovementLink(ID)).toBe(second);
    cleanup();
    const again = twoLinks("first");
    expect(findMovementLink(ID)).toBe(again.first);
    expect(first).not.toBe(again.first);
  });

  it("never picks the link of another movement", () => {
    twoLinks("first");
    expect(findMovementLink("otro")?.textContent).toBe("otro");
  });

  it("falls back to the first one when none has a box (no layout), and to null when there is none", () => {
    const { first } = twoLinks("none");
    expect(findMovementLink(ID)).toBe(first);
    expect(findMovementLink("no-existe")).toBeNull();
  });
});

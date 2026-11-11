import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/lib/core/data/api-client";
import { MovementPanelHost } from "./movement-panel";

// The router, the width and the sheet itself are stand-ins: the sheet has its own test. What is under
// test is when the host shows it, how closing and saving edit the URL, what it does when there is no
// account, and the key N.
const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  search: "",
  sheet: vi.fn(),
  editSheet: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("@/components/movements/movement-sheet", () => ({
  MovementSheet: (props: {
    open: boolean;
    onClose: () => void;
    onSaved: () => void;
    onNoAccounts: () => void;
  }) => {
    mocks.sheet(props);
    return (
      <div data-testid="sheet" data-open={String(props.open)}>
        <button type="button" onClick={props.onClose}>
          cerrar
        </button>
        <button type="button" onClick={props.onSaved}>
          guardado
        </button>
        <button type="button" onClick={props.onNoAccounts}>
          sin cuentas
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/movements/movement-edit-sheet", () => ({
  MovementEditSheet: (props: {
    open: boolean;
    movementId: string;
    onClose: () => void;
    onSaved: () => void;
    onDeleted: () => void;
    onExited?: () => void;
  }) => {
    mocks.editSheet(props);
    return (
      <div data-testid="edit-sheet" data-open={String(props.open)} data-id={props.movementId}>
        <button type="button" onClick={props.onClose}>
          cerrar la edición
        </button>
        <button type="button" onClick={props.onSaved}>
          guardada
        </button>
        <button type="button" onClick={props.onDeleted}>
          eliminada
        </button>
        <button type="button" onClick={props.onExited}>
          salió
        </button>
      </div>
    );
  },
}));

const SPACE = {
  id: "space-1",
  currency: { code: "UYU", exponent: 2 },
  timezone: "America/Montevideo",
};

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
  document.body.replaceChildren();
});

/** The browser at that width: `matchMedia` says it. */
function atWidth(desktop: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: desktop && query === "(min-width: 64rem)" })),
  );
}

/** The URL as Next sees it: what `useSearchParams` returns follows the address bar. */
function visit(search: string, path = "/") {
  mocks.search = search;
  window.history.replaceState(null, "", `${path}${search ? `?${search}` : ""}`);
}

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.sheet.mockReset();
  mocks.editSheet.mockReset();
  atWidth(true);
  visit("");
});

function renderHost(props: Partial<Parameters<typeof MovementPanelHost>[0]> = {}) {
  return render(<MovementPanelHost space={SPACE} {...props} />);
}

describe("when the sheet is shown", () => {
  it("shows nothing, and does not even load the sheet, while it is not asked for", () => {
    renderHost();
    expect(screen.queryByTestId("sheet")).toBeNull();
    expect(mocks.sheet).not.toHaveBeenCalled();
  });

  it("opens it when the URL asks for ?movimiento=nuevo, at any width", async () => {
    for (const desktop of [true, false]) {
      atWidth(desktop);
      visit("movimiento=nuevo");
      const { unmount } = renderHost();
      const sheet = await screen.findByTestId("sheet");
      expect(sheet.getAttribute("data-open")).toBe("true");
      expect(mocks.sheet.mock.calls.at(-1)?.[0]).toMatchObject({ open: true, space: SPACE });
      unmount();
    }
  });

  it("ignores any other value of the param", () => {
    visit("movimiento=otro");
    renderHost();
    expect(screen.queryByTestId("sheet")).toBeNull();
  });

  it("opens nothing without a space (a screen that could not load it)", () => {
    visit("movimiento=nuevo");
    renderHost({ space: undefined });
    expect(screen.queryByTestId("sheet")).toBeNull();
  });

  it("stays out of the way while the panel of a new account is asked for", async () => {
    visit("movimiento=nuevo&cuenta=nueva");
    renderHost();
    expect(screen.queryByTestId("sheet")).toBeNull();
  });

  it("stays mounted, closed, after it was open: its exit animation plays", async () => {
    visit("movimiento=nuevo");
    const { rerender } = renderHost();
    await screen.findByTestId("sheet");
    visit("");
    rerender(<MovementPanelHost space={SPACE} />);
    expect(screen.getByTestId("sheet").getAttribute("data-open")).toBe("false");
  });
});

describe("closing and saving", () => {
  it("takes only ?movimiento out of the URL when the sheet asks to close", async () => {
    visit("sel=abc&movimiento=nuevo", "/cuentas");
    renderHost();
    fireEvent.click(await screen.findByRole("button", { name: "cerrar" }));
    expect(window.location.pathname).toBe("/cuentas");
    expect(window.location.search).toBe("?sel=abc");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("closes first and refreshes the server data after, so the refresh cannot bring it back", async () => {
    visit("movimiento=nuevo");
    renderHost();
    fireEvent.click(await screen.findByRole("button", { name: "guardado" }));
    expect(window.location.search).toBe("");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("adds no history entries when it closes", async () => {
    visit("movimiento=nuevo");
    renderHost();
    const before = window.history.length;
    fireEvent.click(await screen.findByRole("button", { name: "cerrar" }));
    expect(window.history.length).toBe(before);
  });
});

describe("with no account", () => {
  it("swaps the sheet for 'Nueva cuenta' in one write when the sheet finds there is none", async () => {
    visit("sel=abc&movimiento=nuevo", "/cuentas");
    renderHost();
    fireEvent.click(await screen.findByRole("button", { name: "sin cuentas" }));
    expect(window.location.search).toBe("?sel=abc&cuenta=nueva");
  });

  it("goes to 'Nueva cuenta' straight away when the page already knows, and never opens the sheet", async () => {
    visit("movimiento=nuevo");
    renderHost({ noAccounts: true });
    await waitFor(() => expect(window.location.search).toBe("?cuenta=nueva"));
  });

  it("does not touch the URL when the page knows there are no accounts and nothing was asked", () => {
    renderHost({ noAccounts: true });
    expect(window.location.search).toBe("");
  });
});

describe("the key N", () => {
  /** Presses a key on `target` (the page by default) and says whether the host took it. */
  function press(
    key = "n",
    init: KeyboardEventInit = {},
    target: Element | Document = document.body,
  ) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  it("opens 'Registrar movimiento' from 1024 px when the focus is not in a field", () => {
    renderHost();
    const event = press();
    expect(window.location.search).toBe("?movimiento=nuevo");
    expect(event.defaultPrevented).toBe(true);
  });

  it("keeps the other params of the URL", () => {
    visit("sel=abc", "/cuentas");
    renderHost();
    press();
    expect(window.location.pathname).toBe("/cuentas");
    expect(window.location.search).toBe("?sel=abc&movimiento=nuevo");
  });

  it("takes a capital N and Shift+N as the same key", () => {
    renderHost();
    press("N");
    expect(window.location.search).toBe("?movimiento=nuevo");
    visit("");
    press("N", { shiftKey: true });
    expect(window.location.search).toBe("?movimiento=nuevo");
  });

  it("opens 'Nueva cuenta' instead while the page knows there are no accounts", () => {
    renderHost({ noAccounts: true });
    press();
    expect(window.location.search).toBe("?cuenta=nueva");
  });

  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Cmd", { metaKey: true }],
    ["Alt", { altKey: true }],
    ["a key held down (repeat)", { repeat: true }],
    ["an IME composition", { isComposing: true }],
  ])("ignores it with %s", (_name, init) => {
    renderHost();
    const event = press("n", init);
    expect(window.location.search).toBe("");
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores every other key", () => {
    renderHost();
    for (const key of ["m", "Enter", "Escape", "/", "1", " ", "Tab"]) press(key);
    expect(window.location.search).toBe("");
  });

  it("ignores a key somebody already handled", () => {
    // The other handler is registered first, so it runs before the host's.
    document.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
    renderHost();
    press();
    expect(window.location.search).toBe("");
  });

  function field(markup: string) {
    const holder = document.createElement("div");
    holder.innerHTML = markup;
    document.body.append(holder);
    const element = holder.firstElementChild as HTMLElement;
    element.focus();
    return element;
  }

  it.each([
    ["a text input", '<input type="text" />'],
    ["an input with no type", "<input />"],
    ["a search input", '<input type="search" />'],
    ["a number input", '<input type="number" />'],
    ["a date input", '<input type="date" />'],
    ["an email input", '<input type="email" />'],
    ["a textarea", "<textarea></textarea>"],
    ["a select", "<select><option>a</option></select>"],
    ["an editable element", '<div contenteditable="true" tabindex="0"></div>'],
    ["a box with the role textbox", '<div role="textbox" tabindex="0"></div>'],
    ["a combobox", '<div role="combobox" tabindex="0"></div>'],
  ])("ignores it when the focus is on %s", (_name, markup) => {
    renderHost();
    const element = field(markup);
    const event = press("n", {}, element);
    expect(window.location.search).toBe("");
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores it inside an editable element, on a child of it", () => {
    renderHost();
    const outer = field('<div contenteditable="true" tabindex="0"><b>texto</b></div>');
    press("n", {}, outer.querySelector("b") as Element);
    expect(window.location.search).toBe("");
  });

  it.each([
    ["a button", "<button>ok</button>"],
    ["a link", '<a href="#x">ir</a>'],
    ["a checkbox", '<input type="checkbox" />'],
    ["a radio", '<input type="radio" />'],
    ["an element that is editable=false", '<div contenteditable="false" tabindex="0"></div>'],
  ])("takes it when the focus is on %s: no text is typed there", (_name, markup) => {
    renderHost();
    const element = field(markup);
    press("n", {}, element);
    expect(window.location.search).toBe("?movimiento=nuevo");
  });

  it("ignores it below 1024 px, where the sidebar that shows the key does not exist", () => {
    atWidth(false);
    renderHost();
    press();
    expect(window.location.search).toBe("");
  });

  it("asks the width at the key, not once: a window widened later takes it", () => {
    atWidth(false);
    renderHost();
    press();
    expect(window.location.search).toBe("");
    atWidth(true);
    press();
    expect(window.location.search).toBe("?movimiento=nuevo");
  });

  it.each([
    ["a dialog", '<div role="dialog"></div>'],
    ["an alert dialog", '<div role="alertdialog"></div>'],
    ["a menu", '<div role="menu"></div>'],
    ["a modal", '<div aria-modal="true"></div>'],
  ])("ignores it while %s is open: a second sheet must not open over it", (_name, markup) => {
    renderHost();
    const holder = document.createElement("div");
    holder.innerHTML = markup;
    document.body.append(holder);
    press();
    expect(window.location.search).toBe("");
  });

  it("ignores it without a space: nothing could open", () => {
    renderHost({ space: undefined });
    press();
    expect(window.location.search).toBe("");
  });

  it("stops listening when the host unmounts", () => {
    const { unmount } = renderHost();
    unmount();
    press();
    expect(window.location.search).toBe("");
  });
});

describe("editing a movement (FE-23, KAN-83)", () => {
  const ID = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0020";
  const OTHER = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0021";

  it("opens the edit sheet on that movement for ?movimiento=editar&id=<uuid>, at any width", async () => {
    for (const desktop of [true, false]) {
      atWidth(desktop);
      visit(`movimiento=editar&id=${ID}`);
      const { unmount } = renderHost();
      const sheet = await screen.findByTestId("edit-sheet");
      expect(sheet.getAttribute("data-open")).toBe("true");
      expect(sheet.getAttribute("data-id")).toBe(ID);
      expect(mocks.editSheet.mock.calls.at(-1)?.[0]).toMatchObject({ open: true, movementId: ID });
      // The sheet that registers is not asked for.
      expect(screen.queryByTestId("sheet")).toBeNull();
      unmount();
    }
  });

  it("reads the id in lowercase, whatever the case of the address", async () => {
    visit(`movimiento=editar&id=${ID.toUpperCase()}`);
    renderHost();
    expect((await screen.findByTestId("edit-sheet")).getAttribute("data-id")).toBe(ID);
  });

  it("shows nothing, and does not load the edit sheet, while it is not asked for", () => {
    visit("movimiento=nuevo");
    renderHost();
    expect(screen.queryByTestId("edit-sheet")).toBeNull();
    expect(mocks.editSheet).not.toHaveBeenCalled();
  });

  it("takes the params out, in one write, if the id is missing or is not a UUID (it would be a 422)", async () => {
    for (const search of [
      "movimiento=editar",
      "movimiento=editar&id=",
      "movimiento=editar&id=m1",
      `movimiento=editar&id=${ID}x`,
    ]) {
      visit(`mes=2026-09&${search}`, "/movimientos");
      const { unmount } = renderHost();
      await waitFor(() => expect(window.location.search).toBe("?mes=2026-09"));
      expect(screen.queryByTestId("edit-sheet")).toBeNull();
      unmount();
    }
  });

  it("opens nothing without a space, and stays out of the way of the panel of a new account", () => {
    visit(`movimiento=editar&id=${ID}`);
    renderHost({ space: undefined });
    expect(screen.queryByTestId("edit-sheet")).toBeNull();
    cleanup();
    visit(`movimiento=editar&id=${ID}&cuenta=nueva`);
    renderHost();
    expect(screen.queryByTestId("edit-sheet")).toBeNull();
  });

  it("closing takes out ?movimiento and ?id and leaves the filters of the screen", async () => {
    visit(`mes=2026-09&tipo=gastos&movimiento=editar&id=${ID}`, "/movimientos");
    renderHost();
    fireEvent.click(await screen.findByRole("button", { name: "cerrar la edición" }));
    expect(window.location.pathname).toBe("/movimientos");
    expect(window.location.search).toBe("?mes=2026-09&tipo=gastos");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("saving closes first and refreshes the server data after, so the refresh cannot bring it back", async () => {
    visit(`movimiento=editar&id=${ID}`);
    mocks.refresh.mockImplementation(() => {
      // When the refresh runs the address has already lost its params.
      expect(window.location.search).toBe("");
    });
    renderHost();
    fireEvent.click(await screen.findByRole("button", { name: "guardada" }));
    expect(window.location.search).toBe("");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("deleting only closes: the hook that deletes refreshes after the toast", async () => {
    visit(`movimiento=editar&id=${ID}`);
    renderHost();
    fireEvent.click(await screen.findByRole("button", { name: "eliminada" }));
    expect(window.location.search).toBe("");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("keeps the sheet mounted, closed, while it leaves, and drops it when it says it is gone", async () => {
    visit(`movimiento=editar&id=${ID}`);
    const { rerender } = renderHost();
    await screen.findByTestId("edit-sheet");
    visit("");
    rerender(<MovementPanelHost space={SPACE} />);
    expect(screen.getByTestId("edit-sheet").getAttribute("data-open")).toBe("false");
    expect(screen.getByTestId("edit-sheet").getAttribute("data-id")).toBe(ID);
    fireEvent.click(screen.getByRole("button", { name: "salió" }));
    expect(screen.queryByTestId("edit-sheet")).toBeNull();
  });

  it("another movement is another sheet: the key changes, so nothing of the first one stays", async () => {
    visit(`movimiento=editar&id=${ID}`);
    const { rerender } = renderHost();
    const first = await screen.findByTestId("edit-sheet");
    visit(`movimiento=editar&id=${OTHER}`);
    rerender(<MovementPanelHost space={SPACE} />);
    const second = await screen.findByTestId("edit-sheet");
    expect(second.getAttribute("data-id")).toBe(OTHER);
    expect(second).not.toBe(first);
    expect(screen.getAllByTestId("edit-sheet")).toHaveLength(1);
  });

  it("the same movement opened again after it left is mounted again", async () => {
    visit(`movimiento=editar&id=${ID}`);
    const { rerender } = renderHost();
    await screen.findByTestId("edit-sheet");
    visit("");
    rerender(<MovementPanelHost space={SPACE} />);
    fireEvent.click(screen.getByRole("button", { name: "salió" }));
    expect(screen.queryByTestId("edit-sheet")).toBeNull();
    visit(`movimiento=editar&id=${ID}`);
    rerender(<MovementPanelHost space={SPACE} />);
    expect((await screen.findByTestId("edit-sheet")).getAttribute("data-open")).toBe("true");
  });

  it("passes the scripted client to both sheets", async () => {
    const api = { GET: vi.fn() } as unknown as ApiClient;
    visit(`movimiento=editar&id=${ID}`);
    renderHost({ api });
    await screen.findByTestId("edit-sheet");
    expect(mocks.editSheet.mock.calls.at(-1)?.[0]).toMatchObject({ api });
  });

  it("the key N does not open the sheet that registers over an open edit (a dialog is in the page)", async () => {
    visit(`movimiento=editar&id=${ID}`);
    renderHost();
    await screen.findByTestId("edit-sheet");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
    expect(window.location.search).toBe(`?movimiento=editar&id=${ID}`);
  });
});

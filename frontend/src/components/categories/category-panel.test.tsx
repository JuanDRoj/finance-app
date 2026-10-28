import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CategoryPanelHost } from "./category-panel";

// The router, the width and the panel itself are stand-ins: the panel has its own test
// (category-panel-sheet.test.tsx). What is under test is when the host shows it, with what, when it
// sends the visitor to the page of the form instead, and how closing it edits the URL.
const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  search: "",
  desktop: true,
  sheet: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("@/components/use-is-desktop", () => ({
  DESKTOP_MEDIA_QUERY: "(min-width: 64rem)",
  useIsDesktop: () => mocks.desktop,
}));
vi.mock("@/components/categories/category-panel-sheet", () => ({
  CategoryPanelSheet: (props: { open: boolean; onClose: () => void }) => {
    mocks.sheet(props);
    return (
      <div data-testid="panel" data-open={String(props.open)}>
        <button type="button" onClick={props.onClose}>
          cerrar
        </button>
      </div>
    );
  },
}));

const SPACE = { id: "space-1" };

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

/** The browser at that width: `matchMedia` says it, and so does the hook above. */
function atWidth(desktop: boolean) {
  mocks.desktop = desktop;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: desktop })),
  );
}

/** The URL as Next sees it: what `useSearchParams` returns follows the address bar. */
function visit(search: string) {
  mocks.search = search;
  window.history.replaceState(null, "", `/categorias${search ? `?${search}` : ""}`);
}

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.sheet.mockReset();
  atWidth(true);
  visit("");
});

describe("CategoryPanelHost", () => {
  it("shows nothing, and does not even load the panel, while it is not asked for", () => {
    render(<CategoryPanelHost space={SPACE} />);
    expect(screen.queryByTestId("panel")).toBeNull();
    expect(mocks.sheet).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("opens 'Nueva categoría' from 1024 px for ?categoria=nueva, with nothing chosen", async () => {
    visit("categoria=nueva");
    render(<CategoryPanelHost space={SPACE} />);
    expect((await screen.findByTestId("panel")).getAttribute("data-open")).toBe("true");
    expect(mocks.sheet.mock.calls[0]?.[0]).toMatchObject({
      open: true,
      mode: "new",
      space: SPACE,
      categoryId: undefined,
      defaults: { kind: undefined, parentId: undefined },
    });
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("starts the new category on the kind and the principal the URL names", async () => {
    visit("categoria=nueva&tipo=ingresos&padre=p1");
    render(<CategoryPanelHost space={SPACE} />);
    await screen.findByTestId("panel");
    expect(mocks.sheet.mock.calls[0]?.[0]).toMatchObject({
      mode: "new",
      defaults: { kind: "income", parentId: "p1" },
    });
  });

  it("ignores a kind it does not know", async () => {
    visit("categoria=nueva&tipo=otro");
    render(<CategoryPanelHost space={SPACE} />);
    await screen.findByTestId("panel");
    expect(mocks.sheet.mock.calls[0]?.[0].defaults.kind).toBeUndefined();
  });

  it("opens 'Editar categoría' for ?categoria=editar&id=<id>", async () => {
    visit("categoria=editar&id=abc");
    render(<CategoryPanelHost space={SPACE} />);
    expect((await screen.findByTestId("panel")).getAttribute("data-open")).toBe("true");
    expect(mocks.sheet.mock.calls[0]?.[0]).toMatchObject({
      open: true,
      mode: "edit",
      categoryId: "abc",
    });
  });

  it("ignores any other value of the param", () => {
    visit("categoria=otra");
    render(<CategoryPanelHost space={SPACE} />);
    expect(screen.queryByTestId("panel")).toBeNull();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?categoria=otra");
  });

  it("takes the param out when there is nothing to edit (?categoria=editar without id)", () => {
    visit("categoria=editar&tipo=ingresos");
    render(<CategoryPanelHost space={SPACE} />);
    expect(screen.queryByTestId("panel")).toBeNull();
    expect(window.location.search).toBe("?tipo=ingresos");
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("closes by taking out the panel's param and its companions, and keeps the tab of the list", async () => {
    visit("tipo=ingresos&categoria=nueva&padre=p1");
    render(<CategoryPanelHost space={SPACE} />);
    fireEvent.click(await screen.findByRole("button", { name: "cerrar" }));
    expect(window.location.search).toBe("?tipo=ingresos");
  });

  it("closes the edit panel too, id included", async () => {
    visit("categoria=editar&id=abc");
    render(<CategoryPanelHost space={SPACE} />);
    fireEvent.click(await screen.findByRole("button", { name: "cerrar" }));
    expect(window.location.search).toBe("");
  });

  it("passes the API client on to the panel", async () => {
    const api = {} as never;
    visit("categoria=nueva");
    render(<CategoryPanelHost space={SPACE} api={api} />);
    await screen.findByTestId("panel");
    expect(mocks.sheet.mock.calls[0]?.[0].api).toBe(api);
  });
});

describe("below 1024 px there are no panels", () => {
  beforeEach(() => atWidth(false));

  it("sends ?categoria=nueva to the page of the form, with the kind and the principal", () => {
    visit("categoria=nueva&tipo=ingresos&padre=p1");
    render(<CategoryPanelHost space={SPACE} />);
    expect(mocks.replace).toHaveBeenCalledWith("/categorias/nueva?tipo=ingresos&padre=p1");
    expect(screen.queryByTestId("panel")).toBeNull();
  });

  it("sends ?categoria=nueva with nothing else to /categorias/nueva", () => {
    visit("categoria=nueva");
    render(<CategoryPanelHost space={SPACE} />);
    expect(mocks.replace).toHaveBeenCalledWith("/categorias/nueva");
  });

  it("sends ?categoria=editar&id=<id> to the page of that category", () => {
    visit("categoria=editar&id=abc");
    render(<CategoryPanelHost space={SPACE} />);
    expect(mocks.replace).toHaveBeenCalledWith("/categorias/abc");
  });

  it("does nothing without the param", () => {
    render(<CategoryPanelHost space={SPACE} />);
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});

describe("while hydrating", () => {
  it("does not send a desktop to the page: the hook says 'phone' for a moment, the width does not", async () => {
    atWidth(true);
    mocks.desktop = false;
    visit("categoria=nueva");
    render(<CategoryPanelHost space={SPACE} />);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.queryByTestId("panel")).toBeNull();
  });
});

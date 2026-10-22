import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountPanelHost } from "./account-panel";

// The router, the width and the panel itself are stand-ins: the panel has its own test
// (account-panel-sheet.test.tsx). What is under test is when the host shows it, when it sends the
// visitor to the page instead, and how closing it edits the URL.
const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  search: "",
  desktop: true,
  sheet: vi.fn(),
  edit: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("@/components/use-is-desktop", () => ({
  DESKTOP_MEDIA_QUERY: "(min-width: 64rem)",
  useIsDesktop: () => mocks.desktop,
}));
vi.mock("@/components/accounts/account-panel-sheet", () => ({
  AccountPanelSheet: (props: { open: boolean; onClose: () => void }) => {
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

vi.mock("@/components/accounts/account-edit-panel", () => ({
  AccountEditPanel: (props: {
    open: boolean;
    view: string;
    accountId: string;
    onView: (view: "editar" | "cuadrar") => void;
    onClose: () => void;
  }) => {
    mocks.edit(props);
    return (
      <div data-testid="edit-panel" data-open={String(props.open)} data-view={props.view}>
        <button type="button" onClick={() => props.onView("cuadrar")}>
          ir a cuadrar
        </button>
        <button type="button" onClick={props.onClose}>
          cerrar edición
        </button>
      </div>
    );
  },
}));

const SPACE = { id: "space-1", currency: { code: "UYU", exponent: 2 } };

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
  window.history.replaceState(null, "", `/${search ? `?${search}` : ""}`);
}

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.sheet.mockReset();
  mocks.edit.mockReset();
  atWidth(true);
  visit("");
});

describe("AccountPanelHost", () => {
  it("shows nothing, and does not even load the panel, while it is not asked for", () => {
    render(<AccountPanelHost space={SPACE} />);
    expect(screen.queryByTestId("panel")).toBeNull();
    expect(mocks.sheet).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("opens the panel from 1024 px when the URL asks for ?cuenta=nueva", async () => {
    visit("cuenta=nueva");
    render(<AccountPanelHost space={SPACE} />);
    const panel = await screen.findByTestId("panel");
    expect(panel.getAttribute("data-open")).toBe("true");
    expect(mocks.sheet.mock.calls[0]?.[0]).toMatchObject({ open: true, space: SPACE });
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("ignores any other value of the param", () => {
    visit("cuenta=otra");
    render(<AccountPanelHost space={SPACE} />);
    expect(screen.queryByTestId("panel")).toBeNull();
  });

  it("below 1024 px there is no panel: the form is the page", async () => {
    atWidth(false);
    visit("cuenta=nueva");
    render(<AccountPanelHost space={SPACE} />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/cuentas/nueva"));
    expect(screen.queryByTestId("panel")).toBeNull();
  });

  it("asks the browser for the width, not the hook that says 'phone' while hydrating", async () => {
    // The hook still says phone (as it does until hydration ends) but the window is a desktop one.
    mocks.desktop = false;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    visit("cuenta=nueva");
    render(<AccountPanelHost space={SPACE} />);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("opens nothing without a space to create the account in", () => {
    visit("cuenta=nueva");
    render(<AccountPanelHost />);
    expect(screen.queryByTestId("panel")).toBeNull();
  });

  it("closing takes the param out of the URL, keeping the rest, without a history entry", async () => {
    window.history.replaceState(null, "", "/?mes=2026-10&cuenta=nueva");
    mocks.search = "mes=2026-10&cuenta=nueva";
    const length = window.history.length;
    render(<AccountPanelHost space={SPACE} />);
    (await screen.findByText("cerrar")).click();
    expect(window.location.search).toBe("?mes=2026-10");
    expect(window.history.length).toBe(length);
  });

  it("keeps the panel mounted, closed, once the URL no longer asks for it (it plays its exit)", async () => {
    visit("cuenta=nueva");
    const { rerender } = render(<AccountPanelHost space={SPACE} />);
    await screen.findByTestId("panel");
    mocks.search = "";
    rerender(<AccountPanelHost space={SPACE} />);
    expect(screen.getByTestId("panel").getAttribute("data-open")).toBe("false");
  });
});

describe("AccountPanelHost: the panels of an existing account", () => {
  it("opens the edit panel for ?cuenta=editar&sel=<id>, and not the new-account one", async () => {
    visit("sel=a1&cuenta=editar");
    render(<AccountPanelHost space={SPACE} />);
    const panel = await screen.findByTestId("edit-panel");
    expect(panel.getAttribute("data-open")).toBe("true");
    expect(panel.getAttribute("data-view")).toBe("editar");
    expect(mocks.edit.mock.calls[0]?.[0]).toMatchObject({ accountId: "a1", space: SPACE });
    expect(screen.queryByTestId("panel")).toBeNull();
  });

  it("opens the reconcile view for ?cuenta=cuadrar", async () => {
    visit("sel=a1&cuenta=cuadrar");
    render(<AccountPanelHost space={SPACE} />);
    expect((await screen.findByTestId("edit-panel")).getAttribute("data-view")).toBe("cuadrar");
  });

  it("switching view writes ?cuenta in the URL; closing takes only it out, ?sel stays", async () => {
    window.history.replaceState(null, "", "/cuentas?sel=a1&cuenta=editar");
    mocks.search = "sel=a1&cuenta=editar";
    render(<AccountPanelHost space={SPACE} />);
    (await screen.findByText("ir a cuadrar")).click();
    expect(window.location.search).toBe("?sel=a1&cuenta=cuadrar");
    (await screen.findByText("cerrar edición")).click();
    expect(window.location.search).toBe("?sel=a1");
  });

  it("takes ?cuenta out when there is no account to edit (no ?sel)", async () => {
    window.history.replaceState(null, "", "/cuentas?cuenta=editar");
    mocks.search = "cuenta=editar";
    render(<AccountPanelHost space={SPACE} />);
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(screen.queryByTestId("edit-panel")).toBeNull();
  });

  it("below 1024 px goes to the page of the account; cuadrar asks to open the sheet there", async () => {
    atWidth(false);
    visit("sel=a1&cuenta=editar");
    const { unmount } = render(<AccountPanelHost space={SPACE} />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/cuentas/a1"));
    unmount();
    mocks.replace.mockReset();
    visit("sel=a1&cuenta=cuadrar");
    render(<AccountPanelHost space={SPACE} />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/cuentas/a1?cuenta=cuadrar"));
    expect(screen.queryByTestId("edit-panel")).toBeNull();
  });

  it("keeps the edit panel mounted, closed, with what it showed, once the URL stops asking", async () => {
    visit("sel=a1&cuenta=editar");
    const { rerender } = render(<AccountPanelHost space={SPACE} />);
    await screen.findByTestId("edit-panel");
    mocks.search = "sel=a1";
    rerender(<AccountPanelHost space={SPACE} />);
    const panel = screen.getByTestId("edit-panel");
    expect(panel.getAttribute("data-open")).toBe("false");
    expect(panel.getAttribute("data-view")).toBe("editar");
  });

  it("opens nothing without a space", () => {
    visit("sel=a1&cuenta=editar");
    render(<AccountPanelHost />);
    expect(screen.queryByTestId("edit-panel")).toBeNull();
  });
});

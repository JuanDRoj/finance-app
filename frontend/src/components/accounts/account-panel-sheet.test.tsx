import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountPanelSheet } from "./account-panel-sheet";

// The edges are mocked (browser client, router, toast); the sheet and the form are the real ones.
const mocks = vi.hoisted(() => ({ post: vi.fn(), refresh: vi.fn(), toastSuccess: vi.fn() }));

vi.mock("@/lib/api/browser", () => ({ browserApi: { POST: mocks.post } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess } }));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const SPACE = { id: "space-1", currency: { code: "UYU", exponent: 2 } };

beforeEach(() => {
  mocks.post.mockReset().mockResolvedValue({
    data: { id: "a", name: "Itaú", type: "bank", balance_minor: 0 },
    response: new Response(null, { status: 201 }),
  });
  mocks.refresh.mockReset();
  mocks.toastSuccess.mockReset();
});

function renderPanel(onClose = vi.fn(), open = true) {
  const queryClient = new QueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AccountPanelSheet open={open} space={SPACE} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { ...view, onClose };
}

describe("AccountPanelSheet", () => {
  it("is a modal panel named 'Nueva cuenta', on the right, with the form of the panel", () => {
    renderPanel();
    const dialog = screen.getByRole("dialog", { name: "Nueva cuenta" });
    expect(dialog.getAttribute("data-side")).toBe("right");
    expect(within(dialog).getByRole("button", { name: "Cerrar" })).toBeTruthy();
    expect(within(dialog).getByRole("group", { name: "Tipo" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Crear cuenta" })).toBeTruthy();
  });

  it("starts the focus on the name, so the person can type at once", async () => {
    renderPanel();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Nombre")));
  });

  it.each([
    ["the Cerrar button", () => fireEvent.click(screen.getByRole("button", { name: "Cerrar" }))],
    ["Cancelar", () => fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))],
    ["Escape", () => fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })],
    [
      "a click on the veil",
      () => fireEvent.click(document.querySelector("[data-slot='sheet-overlay']") as HTMLElement),
    ],
  ])("asks to close with %s", (_name, act) => {
    const { onClose } = renderPanel();
    act();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes once the account is created, after the toast", async () => {
    const { onClose } = renderPanel();
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Itaú" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Creaste «Itaú»");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("renders nothing while it is closed", () => {
    renderPanel(vi.fn(), false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens with a blank form each time", async () => {
    const queryClient = new QueryClient();
    const onClose = vi.fn();
    const ui = (open: boolean) => (
      <QueryClientProvider client={queryClient}>
        <AccountPanelSheet open={open} space={SPACE} onClose={onClose} />
      </QueryClientProvider>
    );
    const { rerender } = render(ui(true));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Algo a medias" } });
    rerender(ui(false));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    rerender(ui(true));
    expect((await screen.findByLabelText("Nombre")) as HTMLInputElement).toHaveProperty(
      "value",
      "",
    );
  });

  it("closes before refreshing the page, so the refresh cannot bring the panel back", async () => {
    const { onClose } = renderPanel();
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Itaú" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.refresh.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("does not refresh the page when it closes without creating anything", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

// The focus on the way out. The host closes the panel by taking `?cuenta=nueva` out of the URL; here
// a small harness plays that part with state, over a screen with a title and the button that opens it.
describe("AccountPanelSheet, where the focus goes when it closes", () => {
  function Screen() {
    const [open, setOpen] = useState(false);
    const queryClient = new QueryClient();
    return (
      <QueryClientProvider client={queryClient}>
        <h1 tabIndex={-1}>Hola, Ana</h1>
        <button type="button" onClick={() => setOpen(true)}>
          Crear mi primera cuenta
        </button>
        <AccountPanelSheet open={open} space={SPACE} onClose={() => setOpen(false)} />
      </QueryClientProvider>
    );
  }

  async function openFromTheButton() {
    render(<Screen />);
    const opener = screen.getByRole("button", { name: "Crear mi primera cuenta" });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole("dialog", { name: "Nueva cuenta" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Nombre")));
    return opener;
  }

  it("gives it back to the button that opened it when it closes without creating", async () => {
    const opener = await openFromTheButton();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("gives it back to the button too with Escape and with 'Cerrar'", async () => {
    const opener = await openFromTheButton();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));

    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("takes it to the title of the screen after creating an account, not to the button that goes away", async () => {
    const opener = await openFromTheButton();
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Itaú" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Hola, Ana" })),
    );
    expect(document.activeElement).not.toBe(opener);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("goes back to the button on the next opening if the last one had created an account", async () => {
    const opener = await openFromTheButton();
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Itaú" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

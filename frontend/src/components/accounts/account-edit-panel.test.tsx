import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import { AccountEditPanel } from "./account-edit-panel";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/components/use-is-desktop", () => ({
  DESKTOP_MEDIA_QUERY: "(min-width: 64rem)",
  useIsDesktop: () => true,
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: mocks.toastSuccess, error: vi.fn() }),
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const SPACE = { id: "space-1", currency: { code: "UYU", exponent: 2 } };
const API = { GET: mocks.get, PATCH: mocks.patch, POST: mocks.post } as unknown as ApiClient;
const BANK: AccountWithBalance = {
  id: "a1",
  name: "Itaú",
  type: "bank",
  closing_day: null,
  due_day: null,
  archived_at: null,
  balance_minor: 8425000,
};
const ARCHIVED = { ...BANK, id: "a9", name: "Vieja", archived_at: "2026-09-01T00:00:00Z" };

const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) });
const failure = (status: number, body?: unknown) => ({
  error: body,
  response: new Response(null, { status }),
});

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue(ok([BANK, ARCHIVED]));
  mocks.patch.mockReset();
  mocks.post.mockReset().mockResolvedValue(ok(BANK));
  mocks.refresh.mockReset();
  mocks.toastSuccess.mockReset();
});

/** The panel as the host drives it: the view lives in `view`, `onView` changes it. */
function Harness({
  initial = "editar",
  accountId = "a1",
  onClose,
}: {
  initial?: "editar" | "cuadrar";
  accountId?: string;
  onClose: () => void;
}) {
  const [view, setView] = useState(initial);
  return (
    <AccountEditPanel
      open
      view={view}
      space={SPACE}
      accountId={accountId}
      onView={setView}
      onClose={onClose}
      api={API}
    />
  );
}

function renderPanel(props: { initial?: "editar" | "cuadrar"; accountId?: string } = {}) {
  const onClose = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Harness {...props} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe("AccountEditPanel", () => {
  it("shows a skeleton of the body while the account loads", () => {
    mocks.get.mockReturnValue(new Promise(() => {}));
    renderPanel();
    expect(screen.getByRole("dialog", { name: "Editar cuenta" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Cargando la cuenta" })).toBeTruthy();
  });

  it("shows an Alert with Reintentar inside the panel when the account fails to load", async () => {
    mocks.get.mockResolvedValueOnce(failure(500, { code: "internal_error", detail: "x" }));
    renderPanel();
    expect(await screen.findByText("Algo salió mal de nuestro lado")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByLabelText("Nombre")).toBeTruthy();
  });

  it("shows the edit form of the account and puts the focus on the name", async () => {
    renderPanel();
    const name = (await screen.findByLabelText("Nombre")) as HTMLInputElement;
    expect(name.value).toBe("Itaú");
    await waitFor(() => expect(document.activeElement).toBe(name));
  });

  it("closes the panel for an account that is not there or is archived", async () => {
    const { onClose } = renderPanel({ accountId: "a9" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    cleanup();
    const second = renderPanel({ accountId: "nope" });
    await waitFor(() => expect(second.onClose).toHaveBeenCalled());
  });

  it("opens Cuadrar saldo from Editar with 'Volver', and Volver goes back to the form", async () => {
    renderPanel();
    await screen.findByLabelText("Nombre");
    fireEvent.click(screen.getByRole("button", { name: /Cuadrar saldo/ }));
    const dialog = await screen.findByRole("dialog", { name: "Cuadrar saldo" });
    expect(await within(dialog).findByLabelText("Saldo real en tu banco")).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(within(dialog).getByLabelText("Saldo real en tu banco")),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Volver" }));
    expect(await screen.findByLabelText("Nombre")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Volver" })).toBeNull();
  });

  it("opened on Cuadrar saldo (from the detail) has no 'Volver'", async () => {
    renderPanel({ initial: "cuadrar" });
    expect(await screen.findByLabelText("Saldo real en tu banco")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Volver" })).toBeNull();
  });

  it("closes after matching the balance, even when it was reached with 'Volver', and refreshes after closing", async () => {
    const { onClose } = renderPanel();
    await screen.findByLabelText("Nombre");
    fireEvent.click(screen.getByRole("button", { name: /Cuadrar saldo/ }));
    fireEvent.change(await screen.findByLabelText("Saldo real en tu banco"), {
      target: { value: "90000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cuadrar saldo" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(onClose.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.refresh.mock.invocationCallOrder[0]!,
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Cuadraste «Itaú»");
  });

  it("Cancelar closes without refreshing", async () => {
    const { onClose } = renderPanel();
    await screen.findByLabelText("Nombre");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("leaves with a refresh after archiving", async () => {
    const { onClose } = renderPanel();
    await screen.findByLabelText("Nombre");
    fireEvent.click(screen.getByRole("button", { name: /Archivar cuenta/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});

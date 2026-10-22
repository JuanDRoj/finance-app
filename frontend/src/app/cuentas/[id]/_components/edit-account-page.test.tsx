import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditAccountPage } from "./edit-account-page";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  patch: vi.fn(),
  get: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
  canGoBack: true,
  search: "",
}));

vi.mock("@/lib/api/browser", () => ({
  browserApi: { POST: mocks.post, PATCH: mocks.patch, GET: mocks.get },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, back: mocks.back, replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("@/components/back-navigation", () => ({ canGoBackInApp: () => mocks.canGoBack }));
vi.mock("@/components/use-is-desktop", () => ({
  DESKTOP_MEDIA_QUERY: "(min-width: 64rem)",
  useIsDesktop: () => false,
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const SPACE = { id: "space-1", currency: { code: "UYU", exponent: 2 } };
const ACCOUNT = {
  id: "a1",
  name: "Itaú",
  type: "bank" as const,
  closing_day: null,
  due_day: null,
  archived_at: null,
  balance_minor: 8425000,
};
const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) });
const failure = (status: number, body?: unknown) => ({
  error: body,
  response: new Response(null, { status }),
});

beforeEach(() => {
  mocks.post.mockReset().mockResolvedValue(ok({ ...ACCOUNT, archived_at: "2026-10-22T00:00:00Z" }));
  mocks.patch.mockReset().mockResolvedValue(ok({ ...ACCOUNT, name: "Otro" }));
  mocks.get.mockReset().mockResolvedValue(ok(ACCOUNT));
  mocks.refresh.mockReset();
  mocks.back.mockReset();
  mocks.replace.mockReset();
  mocks.canGoBack = true;
  mocks.search = "";
});

function renderPage() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <EditAccountPage account={ACCOUNT} space={SPACE} />
    </QueryClientProvider>,
  );
}

describe("EditAccountPage", () => {
  it("shows the form with 'Más acciones' under it", () => {
    renderPage();
    expect(screen.getByLabelText("Nombre")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Más acciones" })).toBeTruthy();
  });

  it("leaves as /cuentas/nueva does: refresh and back when it came from the app", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Otro" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(mocks.back).toHaveBeenCalledTimes(1));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.refresh.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.back.mock.invocationCallOrder[0]!,
    );
  });

  it("opened directly, it replaces with /cuentas", async () => {
    mocks.canGoBack = false;
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Archivar cuenta/ }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/cuentas"));
    expect(mocks.back).not.toHaveBeenCalled();
  });

  it("opens Cuadrar saldo as a bottom sheet over the page, and closing it stays on the form", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Cuadrar saldo/ }));
    const sheet = await screen.findByRole("dialog", { name: "Cuadrar saldo" });
    expect(sheet.getAttribute("data-side")).toBe("bottom");
    fireEvent.change(within(sheet).getByLabelText("Saldo real en tu banco"), {
      target: { value: "90000" },
    });
    mocks.post.mockResolvedValue(ok({ ...ACCOUNT, balance_minor: 9000000 }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Cuadrar saldo" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Cuadrar saldo" })).toBeNull());
    expect(mocks.back).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nombre")).toBeTruthy();
  });

  it("opens the sheet at once for ?cuenta=cuadrar", async () => {
    mocks.search = "cuenta=cuadrar";
    renderPage();
    expect(await screen.findByRole("dialog", { name: "Cuadrar saldo" })).toBeTruthy();
  });

  it("the 'Cuadrar saldo' of the alert for a balance that is not zero opens the sheet", async () => {
    mocks.post.mockResolvedValue(failure(409, { code: "account_has_balance", detail: "x" }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Archivar cuenta/ }));
    const alert = await screen.findByRole("alertdialog");
    expect(alert.getAttribute("data-placement")).toBe("bottom");
    mocks.post.mockResolvedValue(ok(ACCOUNT));
    fireEvent.click(within(alert).getByRole("button", { name: "Cuadrar saldo" }));
    expect(await screen.findByRole("dialog", { name: "Cuadrar saldo" })).toBeTruthy();
  });
});

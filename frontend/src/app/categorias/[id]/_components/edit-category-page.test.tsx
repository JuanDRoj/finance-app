import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CategoryRead } from "@/lib/core/data/categories";
import { EditCategoryPage } from "./edit-category-page";

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  post: vi.fn(),
  leave: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/api/browser", () => ({ browserApi: { PATCH: mocks.patch, POST: mocks.post } }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: mocks.toastSuccess, error: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../_components/use-leave-form", () => ({ useLeaveForm: () => mocks.leave }));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const COMIDA: CategoryRead = {
  id: "c1",
  name: "Comida",
  kind: "expense",
  icon: "fork-knife",
  parent_id: null,
  archived_at: null,
};
const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) });

// The first render of the form in jsdom pays for warming up the modules, not for the page: it is done
// here so that no test carries that cost.
beforeAll(() => {
  renderPage();
  cleanup();
});

beforeEach(() => {
  mocks.patch
    .mockReset()
    .mockImplementation(async (_path, init) => ok({ ...COMIDA, ...init.body }));
  mocks.post.mockReset().mockResolvedValue(ok({ ...COMIDA, archived_at: "2026-10-28T12:00:00Z" }));
  mocks.leave.mockReset();
  mocks.toastSuccess.mockReset();
});

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EditCategoryPage category={COMIDA} categories={[COMIDA]} space={{ id: "s1" }} />
    </QueryClientProvider>,
  );
}

describe("EditCategoryPage", () => {
  it("is the page variant of the edit form: 'Guardar cambios' in the fixed bar", () => {
    renderPage();
    const bar = document.querySelector("[data-slot='category-form-footer']") as HTMLElement;
    expect(bar.querySelector("button[type='submit']")?.textContent).toBe("Guardar cambios");
    expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe("Comida");
  });

  it("leaves after saving a change", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Mercado" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(mocks.leave).toHaveBeenCalledTimes(1));
    expect(mocks.patch.mock.calls[0]?.[1]?.body).toEqual({ name: "Mercado" });
  });

  it("leaves without a request when there was nothing to save", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(mocks.leave).toHaveBeenCalledTimes(1));
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it("leaves after archiving, the toast with 'Deshacer' outliving the page", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Archivar categoría/ }));
    await waitFor(() => expect(mocks.leave).toHaveBeenCalledTimes(1));
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Archivaste «Comida»",
      expect.objectContaining({ action: expect.objectContaining({ label: "Deshacer" }) }),
    );
  });
});

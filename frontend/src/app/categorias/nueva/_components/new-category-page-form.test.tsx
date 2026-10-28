import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CategoryRead } from "@/lib/core/data/categories";
import { NewCategoryPageForm } from "./new-category-page-form";

const mocks = vi.hoisted(() => ({ post: vi.fn(), leave: vi.fn() }));

vi.mock("@/lib/api/browser", () => ({ browserApi: { POST: mocks.post } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../_components/use-leave-form", () => ({ useLeaveForm: () => mocks.leave }));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const CATEGORIES: CategoryRead[] = [
  {
    id: "p1",
    name: "Trabajo",
    kind: "income",
    icon: "briefcase",
    parent_id: null,
    archived_at: null,
  },
];

// The first render of the form in jsdom pays for warming up the modules (react-hook-form, zod, the 66
// icons), not for the page: it is done here so that no test carries that cost.
beforeAll(() => {
  renderForm();
  cleanup();
});

beforeEach(() => {
  mocks.post.mockReset().mockResolvedValue({
    data: { ...CATEGORIES[0], id: "new", name: "Sueldo" },
    response: new Response(null, { status: 201 }),
  });
  mocks.leave.mockReset();
});

function renderForm(defaults = {}) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NewCategoryPageForm space={{ id: "s1" }} categories={CATEGORIES} defaults={defaults} />
    </QueryClientProvider>,
  );
}

describe("NewCategoryPageForm", () => {
  it("is the page variant of the form: the button in the fixed bar", () => {
    renderForm();
    const bar = document.querySelector("[data-slot='category-form-footer']") as HTMLElement;
    expect(bar.querySelector("button[type='submit']")?.textContent).toBe("Crear categoría");
  });

  it("starts on the principal it is given, and leaves once the category was created", async () => {
    renderForm({ parentId: "p1" });
    expect((screen.getByLabelText("Dentro de") as HTMLSelectElement).value).toBe("p1");
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Sueldo" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear categoría" }));
    await waitFor(() => expect(mocks.leave).toHaveBeenCalledTimes(1));
    expect(mocks.post.mock.calls[0]?.[1]?.body).toMatchObject({
      name: "Sueldo",
      kind: "income",
      parent_id: "p1",
    });
  });

  it("starts on the kind it is given", () => {
    renderForm({ kind: "income" });
    expect((screen.getByLabelText("Ingreso") as HTMLInputElement).checked).toBe(true);
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewCategoryAction } from "./new-category-action";

const mocks = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

beforeEach(() => {
  mocks.search = "";
  window.history.replaceState(null, "", "/categorias");
});

function atWidth(desktop: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: desktop })),
  );
}

const action = () => screen.getByRole("link", { name: "Nueva categoría" });

describe("NewCategoryAction", () => {
  it("is named 'Nueva categoría' at every width: the text is for screen readers on a phone", () => {
    render(<NewCategoryAction />);
    const text = screen.getByText("Nueva categoría");
    expect(text.className).toContain("sr-only");
    expect(text.className).toContain("lg:not-sr-only");
    expect(action().className).toContain("size-11");
    expect(action().className).toContain("lg:bg-primary");
  });

  it("is a link to the page of the form, on the tab the list shows (Gastos by default)", () => {
    render(<NewCategoryAction />);
    expect(action().getAttribute("href")).toBe("/categorias/nueva?tipo=gastos");
  });

  it("starts the form on Ingresos when the tab is Ingresos", () => {
    mocks.search = "tipo=ingresos";
    render(<NewCategoryAction />);
    expect(action().getAttribute("href")).toBe("/categorias/nueva?tipo=ingresos");
  });

  it("falls back to Gastos for a tab it does not know", () => {
    mocks.search = "tipo=otro";
    render(<NewCategoryAction />);
    expect(action().getAttribute("href")).toBe("/categorias/nueva?tipo=gastos");
  });

  it("on a phone follows the link", () => {
    atWidth(false);
    render(<NewCategoryAction />);
    expect(fireEvent.click(action())).toBe(true);
    expect(window.location.search).toBe("");
  });

  it("from 1024 px opens the panel with that kind, and does not navigate", () => {
    atWidth(true);
    mocks.search = "tipo=ingresos";
    render(<NewCategoryAction />);
    expect(fireEvent.click(action())).toBe(false);
    expect(window.location.search).toBe("?categoria=nueva&tipo=ingresos");
  });
});

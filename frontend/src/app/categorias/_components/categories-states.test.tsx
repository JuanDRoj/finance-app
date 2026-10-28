import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CategoriesEmpty } from "./categories-empty";
import { CategoriesError } from "./categories-error";
import { CategoriesSkeleton } from "./categories-skeleton";
import { KindTabs } from "./kind-tabs";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/categorias");
});

describe("CategoriesSkeleton", () => {
  it("is a busy status named 'Cargando categorías', with decorative blocks only", () => {
    const { container } = render(<CategoriesSkeleton />);
    const status = screen.getByRole("status", { name: "Cargando categorías" });
    expect(status.getAttribute("aria-busy")).toBe("true");
    const blocks = container.querySelectorAll("[data-slot='skeleton']");
    expect(blocks.length).toBeGreaterThan(10);
    for (const block of blocks) expect(block.getAttribute("aria-hidden")).toBe("true");
    expect(status.textContent).toBe("");
  });

  it("draws the second card (Ingresos) only from 1024 px", () => {
    const { container } = render(<CategoriesSkeleton />);
    const cards = container.querySelectorAll("[aria-label='Cargando categorías'] > div.flex-col");
    expect(cards).toHaveLength(2);
    expect(cards[1]?.className).toContain("max-lg:hidden");
  });
});

describe("CategoriesError", () => {
  it("says what happened, that the data is safe, and offers to try again", () => {
    const onRetry = vi.fn();
    render(<CategoriesError onRetry={onRetry} busy={false} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("No se pudieron cargar tus categorías")).toBeTruthy();
    expect(
      screen.getByText("Revisa tu conexión e inténtalo de nuevo; tus datos están a salvo."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps the button busy while it asks again, so it is not tapped twice", () => {
    const onRetry = vi.fn();
    render(<CategoriesError onRetry={onRetry} busy />);
    const button = screen.getByRole("button", { name: "Reintentar" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
    expect(onRetry).not.toHaveBeenCalled();
  });
});

describe("CategoriesEmpty", () => {
  it("names the kind that has nothing, and offers to create one or to unarchive", () => {
    const { unmount } = render(<CategoriesEmpty kind="expense" />);
    expect(screen.getByText("No tienes categorías de gasto activas")).toBeTruthy();
    expect(screen.getByText("Crea una o desarchiva alguna de las que guardaste.")).toBeTruthy();
    unmount();
    render(<CategoriesEmpty kind="income" />);
    expect(screen.getByText("No tienes categorías de ingreso activas")).toBeTruthy();
  });

  it("is a heading 3 (the title of the kind is the 2) and its image is decorative", () => {
    const { container } = render(<CategoriesEmpty kind="expense" />);
    expect(screen.getByRole("heading", { level: 3 })).toBeTruthy();
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("'Crear categoría' is a link to the page of the form with that kind chosen", () => {
    atWidth(false);
    render(<CategoriesEmpty kind="income" />);
    const create = screen.getByRole("link", { name: "Crear categoría" });
    expect(create.getAttribute("href")).toBe("/categorias/nueva?tipo=ingresos");
    expect(fireEvent.click(create)).toBe(true);
    expect(window.location.search).toBe("");
  });

  it("opens the panel with that kind from 1024 px, and does not navigate", () => {
    atWidth(true);
    render(<CategoriesEmpty kind="income" />);
    expect(fireEvent.click(screen.getByRole("link", { name: "Crear categoría" }))).toBe(false);
    expect(window.location.search).toBe("?categoria=nueva&tipo=ingresos");
  });
});

function atWidth(desktop: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: desktop })),
  );
}

describe("KindTabs", () => {
  beforeEach(() => window.history.replaceState(null, "", "/categorias?mes=1"));

  it("is a group 'Tipo de categoría' with Gastos and Ingresos, the kind on show checked", () => {
    render(<KindTabs kind="income" />);
    expect(screen.getByRole("group", { name: "Tipo de categoría" })).toBeTruthy();
    expect(
      screen.getAllByRole("radio").map((radio) => radio.nextElementSibling?.textContent),
    ).toEqual(["Gastos", "Ingresos"]);
    expect((screen.getByLabelText("Ingresos") as HTMLInputElement).checked).toBe(true);
  });

  it("writes the kind as ?tipo, keeping the rest of the URL", () => {
    render(<KindTabs kind="expense" />);
    fireEvent.click(screen.getByLabelText("Ingresos"));
    expect(window.location.search).toBe("?mes=1&tipo=ingresos");
  });

  it("has a legend for screen readers only, and is hidden from 1024 px", () => {
    render(<KindTabs kind="expense" />);
    const group = screen.getByRole("group", { name: "Tipo de categoría" });
    expect(group.className).toContain("lg:hidden");
    expect(screen.getByText("Tipo de categoría").className).toContain("sr-only");
  });
});

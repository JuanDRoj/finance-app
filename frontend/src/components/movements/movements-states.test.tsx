import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NEW_ACCOUNT_ACTION, PRIMARY_ACTION } from "@/components/nav-sections";
import { MovementsEmpty } from "./movements-empty";
import { MovementsError } from "./movements-error";
import { MovementsNoResults } from "./movements-no-results";
import { MovementsSkeleton } from "./movements-skeleton";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("MovementsSkeleton", () => {
  it("is a busy status named 'Cargando movimientos', with decorative blocks only", () => {
    const { container } = render(<MovementsSkeleton />);
    const status = screen.getByRole("status", { name: "Cargando movimientos" });
    expect(status.getAttribute("aria-busy")).toBe("true");
    const blocks = container.querySelectorAll("[data-slot='skeleton']");
    expect(blocks.length).toBeGreaterThan(20);
    for (const block of blocks) expect(block.getAttribute("aria-hidden")).toBe("true");
    expect(status.textContent).toBe("");
  });

  it("draws the phone's blocks below 1024 px and the table's from there", () => {
    const { container } = render(<MovementsSkeleton />);
    const status = container.firstElementChild!;
    const parts = Array.from(status.children);
    expect(parts).toHaveLength(4);
    expect(parts[0]!.className).toContain("lg:hidden");
    expect(parts[1]!.className).toContain("hidden");
    expect(parts[1]!.className).toContain("lg:flex");
    expect(parts[2]!.className).toContain("lg:hidden");
    expect(parts[3]!.className).toContain("hidden");
    expect(parts[3]!.className).toContain("lg:block");
  });
});

describe("MovementsError", () => {
  it("says what happened, that the data is safe, and offers to try again", () => {
    const onRetry = vi.fn();
    render(<MovementsError onRetry={onRetry} busy={false} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("No se pudieron cargar tus movimientos")).toBeTruthy();
    expect(
      screen.getByText("Revisa tu conexión e inténtalo de nuevo; tus datos están a salvo."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps the button busy while it asks again, so it is not tapped twice", () => {
    const onRetry = vi.fn();
    render(<MovementsError onRetry={onRetry} busy />);
    const button = screen.getByRole("button", { name: "Reintentar" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("is a single card at every width", () => {
    const { container } = render(<MovementsError onRetry={() => {}} busy={false} />);
    expect(container.querySelectorAll("[data-slot='card']")).toHaveLength(1);
  });
});

describe("MovementsEmpty", () => {
  it("is the invitation of the canvas: the grillo, the title, the text and the button", () => {
    const { container } = render(<MovementsEmpty />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Aún no tienes movimientos");
    expect(
      screen.getByText(
        "Registra un gasto, un ingreso o una transferencia entre tus cuentas. Puedes empezar por lo que gastaste hoy.",
      ),
    ).toBeTruthy();
    const image = container.querySelector("img")!;
    expect(image.getAttribute("alt")).toBe("");
    expect(image.className).toContain("size-30");
    expect(image.className).toContain("lg:size-35");
  });

  it("offers 'Registrar movimiento', a real link that opens the sheet from the main action", () => {
    render(<MovementsEmpty />);
    const link = screen.getByRole("link", { name: "Registrar movimiento" });
    expect(link.getAttribute("href")).toBe(PRIMARY_ACTION!.href);
  });

  it("opens the sheet over the screen at every width, with the URL of the main action", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
    render(<MovementsEmpty />);
    fireEvent.click(screen.getByRole("link", { name: "Registrar movimiento" }));
    expect(window.location.search).toBe("?movimiento=nuevo");
  });

  it("offers 'Nueva cuenta' instead when the page knows there is no account to register on", () => {
    render(<MovementsEmpty action={NEW_ACCOUNT_ACTION} />);
    expect(screen.queryByRole("link", { name: "Registrar movimiento" })).toBeNull();
    expect(screen.getByRole("link", { name: "Nueva cuenta" }).getAttribute("href")).toBe(
      "/cuentas/nueva",
    );
  });

  it("leaves the button out when there is no action at all", () => {
    render(<MovementsEmpty action={null} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Aún no tienes movimientos")).toBeTruthy();
  });

  it("is centered in a glass card on a phone and a left-aligned card of 720 px from 1024 px", () => {
    const { container } = render(<MovementsEmpty />);
    const card = container.querySelector("[data-slot='card']")!;
    expect(card.className).toContain("text-center");
    expect(card.className).toContain("lg:max-w-180");
    expect(card.className).toContain("lg:text-left");
    expect(card.className).toContain("lg:flex-wrap");
  });
});

describe("MovementsNoResults", () => {
  it("says there is nothing for the filters, with a way out", () => {
    render(<MovementsNoResults onClearFilters={() => {}} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "No hay movimientos con estos filtros",
    );
    expect(screen.getByText("Prueba con otro mes, otra búsqueda u otros filtros.")).toBeTruthy();
  });

  it("is a region named after its title", () => {
    render(<MovementsNoResults onClearFilters={() => {}} />);
    expect(
      screen.getByRole("region", { name: "No hay movimientos con estos filtros" }),
    ).toBeTruthy();
  });

  it("clears the filters with 'Quitar filtros'", () => {
    const onClearFilters = vi.fn();
    render(<MovementsNoResults onClearFilters={onClearFilters} />);
    fireEvent.click(screen.getByRole("button", { name: "Quitar filtros" }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("has no button when there is nothing to clear (only the month narrows the list)", () => {
    render(<MovementsNoResults />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("No hay movimientos con estos filtros")).toBeTruthy();
  });

  it("draws the icon and the explanation on a phone only: on desktop it is the title and the button", () => {
    const { container } = render(<MovementsNoResults onClearFilters={() => {}} />);
    const icon = container.querySelector("[aria-hidden='true']")!;
    expect(icon.className).toContain("lg:hidden");
    expect(
      screen.getByText("Prueba con otro mes, otra búsqueda u otros filtros.").className,
    ).toContain("lg:hidden");
    expect(container.firstElementChild!.className).toContain("max-lg:card-surface");
  });

  it("keeps the button at 48 px on a phone, 40 px from 1024 px and 44 px for a finger", () => {
    render(<MovementsNoResults onClearFilters={() => {}} />);
    const button = screen.getByRole("button", { name: "Quitar filtros" });
    expect(button.className).toContain("min-h-12");
    expect(button.className).toContain("lg:min-h-10");
    expect(button.className).toContain("lg:pointer-coarse:min-h-11");
  });
});

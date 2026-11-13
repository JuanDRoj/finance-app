import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/core/data/errors";
import {
  AccountRowsSkeleton,
  AmountSkeleton,
  InlineError,
  TableSkeleton,
  TopExpensesSkeleton,
} from "./dashboard-states";

// The states of the Inicio's cards that are not their data (FE-24, KAN-84).

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

describe("InlineError", () => {
  it("says what happened in Spanish, with the text of the error and that the data is safe", () => {
    const error = new ApiError(500, { code: "internal_error", detail: "Internal Server Error" });
    render(
      <InlineError
        title="No se pudo cargar tu resumen"
        error={error}
        onRetry={vi.fn()}
        busy={false}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("No se pudo cargar tu resumen");
    expect(alert.textContent).toContain("Inténtalo de nuevo en unos minutos");
    expect(alert.textContent).toContain("Tus datos están a salvo");
    // Never the English detail nor the code of the backend.
    expect(screen.queryByText(/Internal Server Error|internal_error/)).toBeNull();
  });

  it("tells a lost connection apart", () => {
    render(
      <InlineError
        title="No se pudo cargar"
        error={new TypeError("Failed to fetch")}
        onRetry={vi.fn()}
        busy={false}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Revisa tu conexión");
  });

  it("has a generic text when it is not told what failed", () => {
    render(<InlineError title="No se pudo cargar" onRetry={vi.fn()} busy={false} />);
    expect(screen.getByRole("alert").textContent).toContain("Tus datos están a salvo");
  });

  it("asks again with 'Reintentar'", () => {
    const onRetry = vi.fn();
    render(<InlineError title="No se pudo cargar" onRetry={onRetry} busy={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps the button busy while it asks, and ignores more clicks", () => {
    const onRetry = vi.fn();
    render(<InlineError title="No se pudo cargar" onRetry={onRetry} busy />);
    const button = screen.getByRole("button", { name: "Reintentar" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("takes the classes of its place", () => {
    render(
      <InlineError
        title="No se pudo cargar"
        onRetry={vi.fn()}
        busy={false}
        className="max-lg:hidden"
      />,
    );
    expect(screen.getByRole("alert").className).toContain("max-lg:hidden");
    expect(screen.getByRole("alert").getAttribute("data-slot")).toBe("inline-error");
  });
});

describe("the skeletons", () => {
  it("hold the place of the five rows of the top, with their bars", () => {
    const { container } = render(<TopExpensesSkeleton />);
    expect(container.firstElementChild?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelectorAll("[data-slot='skeleton']")).toHaveLength(10);
  });

  it("hold the place of the six rows of the table", () => {
    const { container } = render(<TableSkeleton />);
    expect(container.firstElementChild?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelectorAll("[data-slot='skeleton']")).toHaveLength(6);
  });

  it("hold the place of four account rows", () => {
    const { container } = render(<AccountRowsSkeleton />);
    expect(container.firstElementChild?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelectorAll("[data-slot='skeleton']")).toHaveLength(4);
  });

  it("are decorative: a screen reader hears the busy container, not the blocks", () => {
    const { container } = render(
      <>
        <AmountSkeleton />
        <TableSkeleton />
      </>,
    );
    for (const block of container.querySelectorAll("[data-slot='skeleton']")) {
      expect(block.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("let the amount's block take the size it is told", () => {
    const { container } = render(<AmountSkeleton className="h-10 w-48" />);
    const block = container.firstElementChild as HTMLElement;
    expect(block.className).toContain("h-10");
    expect(block.className).toContain("w-48");
    expect(block.className).not.toContain("h-7");
  });
});

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CategoryChip } from "./category-chip";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

describe("CategoryChip", () => {
  it("writes the label, with the whole text in the title", () => {
    render(<CategoryChip category={{ label: "Comida › Supermercado", quiet: false }} />);
    const chip = screen.getByText("Comida › Supermercado");
    expect(chip.getAttribute("title")).toBe("Comida › Supermercado");
  });

  it("is primary-soft for a category and quiet for a transfer or an adjustment", () => {
    const { rerender } = render(<CategoryChip category={{ label: "Comida", quiet: false }} />);
    expect(screen.getByText("Comida").className).toContain("bg-primary-soft");
    rerender(<CategoryChip category={{ label: "Transferencia", quiet: true }} />);
    const quiet = screen.getByText("Transferencia");
    expect(quiet.className).toContain("text-muted-foreground");
    expect(quiet.className).not.toContain("bg-primary-soft");
  });

  it("is cut with an ellipsis, never wrapped, and takes the class the table gives it", () => {
    render(<CategoryChip category={{ label: "x".repeat(200), quiet: false }} className="mt-1" />);
    const chip = screen.getByText("x".repeat(200));
    expect(chip.className).toContain("truncate");
    expect(chip.className).toContain("max-w-56");
    expect(chip.className).toContain("mt-1");
  });
});

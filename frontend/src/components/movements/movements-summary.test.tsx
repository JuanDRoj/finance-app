import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MovementsSummary } from "./movements-summary";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const UYU = { code: "UYU", exponent: 2 } as const;
const SUMMARY = {
  count: 48,
  income_minor: 6815000,
  expense_minor: 3677000,
  remaining_minor: 3138000,
};

function figure(label: string) {
  const region = screen.getByRole("region");
  const labelNode = within(region).getByText(label);
  return { label: labelNode, value: labelNode.nextElementSibling as HTMLElement };
}

describe("MovementsSummary", () => {
  it("is a region named after the period", () => {
    render(<MovementsSummary summary={SUMMARY} currency={UYU} period="Octubre 2026" />);
    expect(screen.getByRole("region", { name: "Resumen de Octubre 2026" })).toBeTruthy();
  });

  it("writes Ingresos, Gastos and Te quedan with the signs of the canvas", () => {
    render(<MovementsSummary summary={SUMMARY} currency={UYU} period="Octubre 2026" />);
    expect(figure("Ingresos").value.textContent).toBe("+$ 68.150,00");
    expect(figure("Gastos").value.textContent).toBe("−$ 36.770,00");
    expect(figure("Te quedan").value.textContent).toBe("+$ 31.380,00");
  });

  it("paints the income in its color and the other two in the text color", () => {
    render(<MovementsSummary summary={SUMMARY} currency={UYU} period="Octubre 2026" />);
    expect(figure("Ingresos").value.className).toContain("text-income");
    expect(figure("Gastos").value.className).toContain("text-foreground");
    expect(figure("Te quedan").value.className).toContain("text-foreground");
  });

  it("uses tabular figures at 16 px on a phone and 22 px from 1024 px", () => {
    render(<MovementsSummary summary={SUMMARY} currency={UYU} period="Octubre 2026" />);
    for (const label of ["Ingresos", "Gastos", "Te quedan"]) {
      const { value } = figure(label);
      expect(value.className).toContain("tabular-nums");
      expect(value.className).toContain("text-base");
      expect(value.className).toContain("lg:text-panel-title");
      expect(value.className).toContain("font-heading");
    }
  });

  it("is a glass card on a phone and three solid cards from 1024 px", () => {
    render(<MovementsSummary summary={SUMMARY} currency={UYU} period="Octubre 2026" />);
    const region = screen.getByRole("region");
    expect(region.className).toContain("max-lg:card-surface");
    const cards = Array.from(region.children);
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card.className).toContain("lg:bg-surface");
      expect(card.className).toContain("lg:rounded-card");
    }
  });

  it("puts 'Te quedan' under the other two on a phone, after a line", () => {
    render(<MovementsSummary summary={SUMMARY} currency={UYU} period="Octubre 2026" />);
    const remaining = screen.getByRole("region").children[2]!;
    expect(remaining.className).toContain("max-lg:col-span-2");
    expect(remaining.className).toContain("max-lg:border-t");
    expect(remaining.className).toContain("max-lg:justify-between");
  });

  it("shows a loss with the minus and a quiet month with no income in the text color", () => {
    render(
      <MovementsSummary
        summary={{ count: 3, income_minor: 0, expense_minor: 500000, remaining_minor: -500000 }}
        currency={UYU}
        period="Octubre 2026"
      />,
    );
    expect(figure("Ingresos").value.textContent).toBe("$ 0,00");
    expect(figure("Ingresos").value.className).toContain("text-foreground");
    expect(figure("Te quedan").value.textContent).toBe("−$ 5.000,00");
  });

  it("lets the largest figures wrap before they overflow", () => {
    const max = Number.MAX_SAFE_INTEGER;
    render(
      <MovementsSummary
        summary={{ count: 1, income_minor: max, expense_minor: max, remaining_minor: 0 }}
        currency={UYU}
        period="Octubre 2026"
      />,
    );
    expect(figure("Ingresos").value.textContent).toBe("+$ 90.071.992.547.409,91");
    expect(figure("Ingresos").value.className).toContain("wrap-anywhere");
    expect(screen.getByRole("region").children[0]!.className).toContain("min-w-0");
  });

  it("takes the class the screen gives it", () => {
    render(
      <MovementsSummary summary={SUMMARY} currency={UYU} period="Octubre 2026" className="mb-4" />,
    );
    expect(screen.getByRole("region").className).toContain("mb-4");
  });
});

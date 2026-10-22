import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MoneyField } from "./money-field";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const UYU = { code: "UYU", exponent: 2 };

function input(label = "Saldo actual") {
  return screen.getByLabelText(label) as HTMLInputElement;
}

describe("MoneyField", () => {
  it("is a text input with the decimal keyboard and no autofill, bound to its label", () => {
    render(<MoneyField label="Saldo actual" currency={UYU} />);
    const field = input();
    expect(field.type).toBe("text");
    expect(field.inputMode).toBe("decimal");
    expect(field.getAttribute("autocomplete")).toBe("off");
    expect(field.getAttribute("autocapitalize")).toBe("none");
    expect(field.getAttribute("autocorrect")).toBe("off");
    expect(field.getAttribute("spellcheck")).toBe("false");
    expect(field.getAttribute("enterkeyhint")).toBe("done");
  });

  it.each([
    ["UYU", "$"],
    ["COP", "$"],
    ["USD", "US$"],
    ["ARS", "$"],
    ["BRL", "R$"],
    ["EUR", "€"],
  ])("writes the symbol of %s (%s) in front, decorative", (code, symbol) => {
    const { container } = render(
      <MoneyField label="Saldo actual" currency={{ code, exponent: 2 }} />,
    );
    const prefix = container.querySelector("[aria-hidden='true']");
    expect(prefix?.textContent).toBe(symbol);
    // The accessible name is the label alone: the symbol is not part of it.
    expect(input().labels?.[0]?.textContent).toBe("Saldo actual");
  });

  it("never fixes a '$': a space in dollars shows 'US$'", () => {
    const { container } = render(
      <MoneyField label="Saldo actual" currency={{ code: "USD", exponent: 2 }} />,
    );
    expect(container.textContent).toContain("US$");
    expect(container.querySelector("[aria-hidden='true']")?.textContent).not.toBe("$");
  });

  it("makes room for the symbol according to its length", () => {
    const { unmount } = render(<MoneyField label="Saldo actual" currency={UYU} />);
    // 14 px from the edge + the width of the symbol (in "0" widths of this font) + 8 px of air.
    expect(input().style.paddingLeft).toMatch(/^calc\(.*\b1ch\b.*\)$/);
    unmount();
    render(<MoneyField label="Saldo actual" currency={{ code: "USD", exponent: 2 }} />);
    expect(input().style.paddingLeft).toMatch(/^calc\(.*\b3ch\b.*\)$/);
  });

  it("tells assistive technology the currency, as part of the description", () => {
    render(<MoneyField label="Saldo actual" currency={UYU} description="Lo que tienes hoy." />);
    const describedBy = (input().getAttribute("aria-describedby") ?? "").split(" ");
    const texts = describedBy.map((id) => document.getElementById(id)?.textContent);
    expect(texts).toContain("Lo que tienes hoy.");
    expect(texts).toContain("Moneda: Peso uruguayo · UYU");
  });

  it("writes the figures in Montserrat 600 at 18 px, tabular", () => {
    render(<MoneyField label="Saldo actual" currency={UYU} />);
    const { className } = input();
    for (const expected of ["font-heading", "text-lg", "font-semibold", "tabular-nums"]) {
      expect(className).toContain(expected);
    }
    // 16 px or more, so iOS Safari does not zoom on focus (text-lg is 18 px).
    expect(className).not.toMatch(/(^|\s)text-(xs|sm)(\s|$)/);
  });

  it("uses the debt color for a card's debt, and the text color otherwise", () => {
    const { unmount } = render(<MoneyField label="Deuda actual" currency={UYU} tone="debt" />);
    expect(input("Deuda actual").className).toContain("text-debt");
    expect(input("Deuda actual").className).not.toContain("text-foreground");
    unmount();
    render(<MoneyField label="Saldo actual" currency={UYU} />);
    expect(input().className).toContain("text-foreground");
    expect(input().className).not.toContain("text-debt");
  });

  it("marks the input invalid and links the error", () => {
    render(<MoneyField label="Saldo actual" currency={UYU} error="Usa como máximo 2 decimales." />);
    expect(input().getAttribute("aria-invalid")).toBe("true");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Usa como máximo 2 decimales.");
    expect(input().getAttribute("aria-describedby")).toContain(alert.id);
  });

  it("keeps what the person types as text: it does no arithmetic", () => {
    render(<MoneyField label="Saldo actual" currency={UYU} />);
    fireEvent.change(input(), { target: { value: "1550,50" } });
    expect(input().value).toBe("1550,50");
  });

  it("works with register(): the text reaches the form", async () => {
    const onSubmit = vi.fn();
    function Form() {
      const { register, handleSubmit } = useForm({ defaultValues: { balance: "" } });
      return (
        <form onSubmit={handleSubmit(onSubmit)}>
          <MoneyField label="Saldo actual" currency={UYU} {...register("balance")} />
          <button type="submit">Enviar</button>
        </form>
      );
    }
    render(<Form />);
    fireEvent.change(input(), { target: { value: "0,29" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ balance: "0,29" });
  });
});

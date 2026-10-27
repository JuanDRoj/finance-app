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

  it("keeps the 48 px default field apart from the big one: no hero classes, no CSS variable", () => {
    render(<MoneyField label="Saldo actual" currency={UYU} />);
    expect(input().className).not.toMatch(/text-amount|border-b-2|lg:h-15/);
    expect(input().style.getPropertyValue("--symbol-chars")).toBe("");
  });
});

describe('MoneyField size="hero" (KAN-94)', () => {
  function hero(props: Partial<React.ComponentProps<typeof MoneyField>> = {}) {
    return render(<MoneyField label="Monto" currency={UYU} size="hero" {...props} />);
  }

  it("is the big amount: 38 px figures on the phone and 28 px from 1024 px, in Montserrat 600, tabular", () => {
    hero();
    const { className } = input("Monto");
    for (const expected of [
      "font-heading",
      "font-semibold",
      "tabular-nums",
      "text-amount",
      "lg:text-amount-panel",
    ]) {
      expect(className.split(" ")).toContain(expected);
    }
    // It replaces the 18 px of the default field, and stays at 16 px or more (iOS zooms below that).
    expect(className.split(" ")).not.toContain("text-lg");
    expect(className).not.toMatch(/(^|\s)text-(xs|sm|base)(\s|$)/);
  });

  it("is an underline on the phone (no box) and a 60 px box from 1024 px", () => {
    hero();
    const classes = input("Monto").className.split(" ");
    // The phone: a 2 px underline in primary, transparent, no side border, no box radius.
    for (const expected of [
      "border-0",
      "border-b-2",
      "border-primary",
      "bg-transparent",
      "rounded-none",
    ]) {
      expect(classes).toContain(expected);
    }
    // Desktop: the field of the other forms, 60 px tall, with its border color and solid background.
    for (const expected of [
      "lg:h-15",
      "lg:border",
      "lg:border-input",
      "lg:bg-card-solid",
      "lg:rounded-field",
    ]) {
      expect(classes).toContain(expected);
    }
    // The 48 px, boxed look of the default field is gone below 1024 px.
    expect(classes).not.toContain("h-12");
    expect(classes).not.toContain("px-4");
  });

  it("turns the underline red when invalid, and draws the red box only on desktop", () => {
    hero({ error: "El monto debe ser mayor que 0." });
    const field = input("Monto");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const classes = field.className.split(" ");
    expect(classes).toContain("aria-invalid:border-destructive");
    expect(classes).toContain("aria-invalid:ring-0");
    // The box's border color would lose to `lg:border-input`, so it is stated under `lg:` too.
    expect(classes).toContain("lg:aria-invalid:border-destructive");
    expect(classes).toContain("lg:aria-invalid:ring-1");
    expect(classes).not.toContain("aria-invalid:ring-1");
    expect(screen.getByRole("alert").textContent).toContain("El monto debe ser mayor que 0.");
  });

  it.each([
    ["UYU", "$", "1"],
    ["USD", "US$", "3"],
    ["BRL", "R$", "2"],
    ["EUR", "€", "1"],
  ])(
    "makes room for the symbol of %s (%s) with a variable, not a fixed padding",
    (code, symbol, chars) => {
      const { container } = hero({ currency: { code, exponent: 2 } });
      const field = input("Monto");
      expect(container.querySelector("[aria-hidden='true']")?.textContent).toBe(symbol);
      expect(field.style.getPropertyValue("--symbol-chars")).toBe(chars);
      // The room is a class that reads the variable (it changes with the width), not an inline padding.
      expect(field.style.paddingLeft).toBe("");
      expect(field.className).toContain("pl-[calc(var(--symbol-chars)");
      expect(field.className).toContain("lg:pl-[calc(1.125rem+var(--symbol-chars)");
    },
  );

  it("sizes the symbol with the figures: 26 px, then 22 px from 1024 px, on the left edge of the phone", () => {
    const { container } = hero();
    const symbol = container.querySelector("[aria-hidden='true'] > span") as HTMLElement;
    expect(symbol.className).toContain("text-amount-symbol");
    expect(symbol.className).toContain("lg:text-amount-symbol-panel");
    expect(symbol.className).not.toContain("text-lg");
    const box = symbol.parentElement as HTMLElement;
    // 0 px from the edge on the phone and 18 px inside the box from 1024 px, with the `left-3.5` of the default gone.
    expect(box.className.split(" ")).toContain("left-0");
    expect(box.className.split(" ")).toContain("lg:left-4.5");
    expect(box.className.split(" ")).not.toContain("left-3.5");
  });

  it("is still a decimal-keyboard text field bound to its label, with the currency read aloud", () => {
    hero({ description: "Lo que gastaste." });
    const field = input("Monto");
    expect(field.type).toBe("text");
    expect(field.inputMode).toBe("decimal");
    expect(field.getAttribute("autocomplete")).toBe("off");
    const describedBy = (field.getAttribute("aria-describedby") ?? "").split(" ");
    const texts = describedBy.map((id) => document.getElementById(id)?.textContent);
    expect(texts).toContain("Moneda: Peso uruguayo · UYU");
    expect(texts).toContain("Lo que gastaste.");
  });

  it("keeps the debt color and lets a class of the caller win", () => {
    hero({ tone: "debt", inputClassName: "tracking-tight" });
    const classes = input("Monto").className.split(" ");
    expect(classes).toContain("text-debt");
    expect(classes).not.toContain("text-foreground");
    expect(classes).toContain("tracking-tight");
    expect(classes).not.toContain("tracking-amount");
  });

  it("keeps a style of the caller next to the variable", () => {
    hero({ style: { color: "red" } });
    expect(input("Monto").style.getPropertyValue("--symbol-chars")).toBe("1");
    expect(input("Monto").style.color).toBe("red");
  });

  it("works with register(): the text reaches the form", async () => {
    const onSubmit = vi.fn();
    function Form() {
      const { register, handleSubmit } = useForm({ defaultValues: { amount: "" } });
      return (
        <form onSubmit={handleSubmit(onSubmit)}>
          <MoneyField label="Monto" currency={UYU} size="hero" {...register("amount")} />
          <button type="submit">Enviar</button>
        </form>
      );
    }
    render(<Form />);
    fireEvent.change(input("Monto"), { target: { value: "2340,50" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ amount: "2340,50" });
  });
});

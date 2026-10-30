import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TypeChips } from "./type-chips";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

describe("TypeChips", () => {
  it("is a group of four buttons: Todos, Gastos, Ingresos and Transferencias", () => {
    render(<TypeChips type={undefined} onTypeChange={() => {}} />);
    const group = screen.getByRole("group", { name: "Tipo de movimiento" });
    expect(within(group).getAllByRole("button")).toHaveLength(4);
    // By their accessible names, in this order.
    const buttons = within(group).getAllByRole("button");
    ["Todos", "Gastos", "Ingresos", "Transferencias"].forEach((name, index) => {
      expect(within(group).getByRole("button", { name })).toBe(buttons[index]);
    });
  });

  it("presses Todos when there is no type, and only one at a time", () => {
    render(<TypeChips type={undefined} onTypeChange={() => {}} />);
    const pressed = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed.map((b) => b.textContent)).toEqual(["Todos"]);
  });

  it.each([
    ["expense", "Gastos"],
    ["income", "Ingresos"],
    ["transfer", "Transferencias"],
  ] as const)("presses only %s's chip when it is the type", (type, name) => {
    render(<TypeChips type={type} onTypeChange={() => {}} />);
    const buttons = screen.getAllByRole("button");
    const pressed = buttons.filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    expect(screen.getByRole("button", { name }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Todos" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("tells the screen the type that was chosen, and undefined for Todos", () => {
    const onTypeChange = vi.fn();
    render(<TypeChips type="expense" onTypeChange={onTypeChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Ingresos" }));
    expect(onTypeChange).toHaveBeenLastCalledWith("income");
    fireEvent.click(screen.getByRole("button", { name: "Transferencias" }));
    expect(onTypeChange).toHaveBeenLastCalledWith("transfer");
    fireEvent.click(screen.getByRole("button", { name: "Todos" }));
    expect(onTypeChange).toHaveBeenLastCalledWith(undefined);
  });

  it("writes 'Transf.' on a phone and 'Transferencias' from 1024 px, but is always named Transferencias", () => {
    render(<TypeChips type={undefined} onTypeChange={() => {}} />);
    const chip = screen.getByRole("button", { name: "Transferencias" });
    const [short, long] = Array.from(chip.children);
    expect(short!.textContent).toBe("Transf.");
    expect(short!.getAttribute("aria-hidden")).toBe("true");
    expect(short!.className).toContain("lg:hidden");
    expect(long!.textContent).toBe("Transferencias");
    expect(long!.className).toContain("sr-only");
    expect(long!.className).toContain("lg:not-sr-only");
  });

  it("is chips of their natural width, 44 px tall, on a phone", () => {
    render(<TypeChips type={undefined} onTypeChange={() => {}} />);
    const chip = screen.getByRole("button", { name: "Gastos" });
    expect(chip.className).toContain("min-h-11");
    expect(chip.className).toContain("px-3.5");
    expect(chip.className).toContain("flex-auto");
    expect(chip.className).toContain("rounded-full");
    expect(chip.className).toContain("text-sm");
    expect(screen.getByRole("group").className).toContain("flex-wrap");
  });

  it("is one segmented pill from 1024 px, with buttons of 34 px (44 for a finger)", () => {
    render(<TypeChips type={undefined} onTypeChange={() => {}} />);
    const group = screen.getByRole("group").className;
    expect(group).toContain("lg:rounded-full");
    expect(group).toContain("lg:p-1");
    expect(group).toContain("lg:bg-foreground/6");
    const chip = screen.getByRole("button", { name: "Gastos" }).className;
    expect(chip).toContain("lg:min-h-8.5");
    expect(chip).toContain("lg:pointer-coarse:min-h-11");
    expect(chip).toContain("lg:border-0");
  });

  it("paints the chosen one in primary and the others with the border of a control", () => {
    render(<TypeChips type="income" onTypeChange={() => {}} />);
    const chosen = screen.getByRole("button", { name: "Ingresos" }).className;
    expect(chosen).toContain("bg-primary");
    expect(chosen).toContain("text-primary-foreground");
    expect(chosen).toContain("font-bold");
    const other = screen.getByRole("button", { name: "Gastos" }).className;
    expect(other).toContain("border-input");
    expect(other).toContain("font-semibold");
    expect(other).not.toContain("bg-primary");
  });

  it("is a button of type button: it never submits a form around it", () => {
    render(<TypeChips type={undefined} onTypeChange={() => {}} />);
    for (const button of screen.getAllByRole("button")) {
      expect(button.getAttribute("type")).toBe("button");
    }
  });
});

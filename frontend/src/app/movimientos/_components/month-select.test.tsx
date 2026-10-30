import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MonthSelect } from "./month-select";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const CURRENT = "2026-10";

describe("MonthSelect", () => {
  it("is a native select named Mes, with the month that is on show chosen", () => {
    render(<MonthSelect month="2026-09" currentMonth={CURRENT} onMonthChange={() => {}} />);
    const select = screen.getByRole("combobox", { name: "Mes" }) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(select.value).toBe("2026-09");
    expect(select.selectedOptions[0]!.textContent).toBe("Setiembre 2026");
  });

  it("lists the months from six ahead to 36 back, newest first, in words", () => {
    render(<MonthSelect month={CURRENT} currentMonth={CURRENT} onMonthChange={() => {}} />);
    const options = within(screen.getByRole("combobox", { name: "Mes" })).getAllByRole("option");
    expect(options).toHaveLength(43);
    expect(options[0]!.textContent).toBe("Abril 2027");
    expect(options[6]!.textContent).toBe("Octubre 2026");
    expect(options.at(-1)!.textContent).toBe("Octubre 2023");
    expect((options[0] as HTMLOptionElement).value).toBe("2027-04");
  });

  it("tells which month was chosen as YYYY-MM", () => {
    const onMonthChange = vi.fn();
    render(<MonthSelect month={CURRENT} currentMonth={CURRENT} onMonthChange={onMonthChange} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Mes" }), {
      target: { value: "2026-03" },
    });
    expect(onMonthChange).toHaveBeenCalledWith("2026-03");
  });

  it("still names a month that is far out of the list (a link or the phone's arrows got there)", () => {
    render(<MonthSelect month="2019-03" currentMonth={CURRENT} onMonthChange={() => {}} />);
    const select = screen.getByRole("combobox", { name: "Mes" }) as HTMLSelectElement;
    expect(select.value).toBe("2019-03");
    expect(select.selectedOptions[0]!.textContent).toBe("Marzo 2019");
    expect(within(select).getAllByRole("option")).toHaveLength(44);
  });

  it("draws the calendar and the caret out of reach of the pointer and of speech", () => {
    const { container } = render(
      <MonthSelect month={CURRENT} currentMonth={CURRENT} onMonthChange={() => {}} />,
    );
    const icons = container.querySelectorAll("svg");
    expect(icons).toHaveLength(2);
    for (const icon of icons) {
      expect(icon.getAttribute("aria-hidden")).toBe("true");
      expect(icon.getAttribute("class")).toContain("pointer-events-none");
    }
  });

  it("is a pill of 42 px (44 for a finger) with the border of a control", () => {
    render(<MonthSelect month={CURRENT} currentMonth={CURRENT} onMonthChange={() => {}} />);
    const classes = screen.getByRole("combobox", { name: "Mes" }).className;
    expect(classes).toContain("h-10.5");
    expect(classes).toContain("pointer-coarse:h-11");
    // 15 px with a mouse, 16 px with a finger: under 16 px iOS zooms into the field when it is focused.
    expect(classes).toContain("text-item");
    expect(classes).toContain("pointer-coarse:text-base");
    expect(classes).toContain("rounded-full");
    expect(classes).toContain("border-input");
    expect(classes).toContain("appearance-none");
  });

  it("takes the class the screen gives it", () => {
    const { container } = render(
      <MonthSelect month={CURRENT} currentMonth={CURRENT} onMonthChange={() => {}} className="x" />,
    );
    expect(container.firstElementChild!.className).toContain("x");
    expect(container.firstElementChild!.getAttribute("data-slot")).toBe("month-select");
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MonthNav } from "./month-nav";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

describe("MonthNav", () => {
  it("is a group named Mes with the month in words between two arrows", () => {
    render(<MonthNav month="2026-10" onMonthChange={() => {}} />);
    const group = screen.getByRole("group", { name: "Mes" });
    expect(group.textContent).toBe("Octubre 2026");
    expect(screen.getByRole("button", { name: "Mes anterior" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mes siguiente" })).toBeTruthy();
  });

  it("does not announce the month by itself: the screen's status region says month and count once", () => {
    const { container } = render(<MonthNav month="2026-10" onMonthChange={() => {}} />);
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(container.querySelector("[role='status'], [role='alert']")).toBeNull();
  });

  it("keeps the arrows' icons out of speech", () => {
    const { container } = render(<MonthNav month="2026-10" onMonthChange={() => {}} />);
    for (const svg of container.querySelectorAll("svg")) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("goes to the month before and the month after", () => {
    const onMonthChange = vi.fn();
    render(<MonthNav month="2026-10" onMonthChange={onMonthChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    expect(onMonthChange).toHaveBeenLastCalledWith("2026-09");
    fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }));
    expect(onMonthChange).toHaveBeenLastCalledWith("2026-11");
  });

  it("crosses the year in both directions", () => {
    const onMonthChange = vi.fn();
    const { rerender } = render(<MonthNav month="2026-01" onMonthChange={onMonthChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    expect(onMonthChange).toHaveBeenLastCalledWith("2025-12");
    rerender(<MonthNav month="2026-12" onMonthChange={onMonthChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }));
    expect(onMonthChange).toHaveBeenLastCalledWith("2027-01");
  });

  it("lets the person go past the current month: a movement can be dated ahead", () => {
    const onMonthChange = vi.fn();
    render(<MonthNav month="2027-06" onMonthChange={onMonthChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }));
    expect(onMonthChange).toHaveBeenCalledWith("2027-07");
  });

  it("turns the previous arrow off at 1900-01 and does nothing when it is pressed", () => {
    const onMonthChange = vi.fn();
    render(<MonthNav month="1900-01" onMonthChange={onMonthChange} />);
    const previous = screen.getByRole("button", { name: "Mes anterior" });
    expect(previous.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(previous);
    expect(onMonthChange).not.toHaveBeenCalled();
    const next = screen.getByRole("button", { name: "Mes siguiente" });
    expect(next.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(next);
    expect(onMonthChange).toHaveBeenCalledWith("1900-02");
  });

  it("turns the next arrow off at 2199-12", () => {
    const onMonthChange = vi.fn();
    render(<MonthNav month="2199-12" onMonthChange={onMonthChange} />);
    const next = screen.getByRole("button", { name: "Mes siguiente" });
    expect(next.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(next);
    expect(onMonthChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    expect(onMonthChange).toHaveBeenCalledWith("2199-11");
  });

  it("keeps both arrows on at the months in between the edges", () => {
    render(<MonthNav month="1900-02" onMonthChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: "Mes anterior" }).getAttribute("aria-disabled"),
    ).toBeNull();
    expect(screen.getByText("Febrero 1900")).toBeTruthy();
  });

  it("has arrows of 44 px and a label that does not jump (at least 112 px wide)", () => {
    render(<MonthNav month="2026-10" onMonthChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Mes anterior" }).className).toContain("size-11");
    expect(screen.getByRole("button", { name: "Mes siguiente" }).className).toContain("size-11");
    expect(screen.getByText("Octubre 2026").className).toContain("min-w-28");
  });
});

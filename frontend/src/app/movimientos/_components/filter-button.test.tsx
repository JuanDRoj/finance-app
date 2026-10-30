import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilterButton } from "./filter-button";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

describe("FilterButton", () => {
  it("is named 'Filtrar' with no filters, and has no number", () => {
    render(<FilterButton count={0} onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "Filtrar" });
    expect(button.textContent).toBe("Filtrar");
  });

  it("says how many filters are on in its name, and draws the number", () => {
    const { rerender } = render(<FilterButton count={1} onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Filtrar, 1 filtro activo" }).textContent).toBe(
      "Filtrar1",
    );
    rerender(<FilterButton count={2} onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Filtrar, 2 filtros activos" })).toBeTruthy();
  });

  it("hides the number from speech: the name already says it", () => {
    render(<FilterButton count={2} onClick={() => {}} />);
    const badge = screen.getByText("2");
    expect(badge.getAttribute("aria-hidden")).toBe("true");
    expect(badge.className).toContain("rounded-full");
    expect(badge.className).toContain("bg-primary");
  });

  it("is a pill of 44 px for a phone, with the funnel out of speech", () => {
    render(<FilterButton count={0} onClick={() => {}} />);
    const button = screen.getByRole("button");
    for (const cls of ["h-11", "rounded-full", "border-input", "lg:hidden"]) {
      expect(button.className).toContain(cls);
    }
    expect(button.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("opens on a click, and warms the sheet up when the pointer goes down or the focus arrives", () => {
    const onClick = vi.fn();
    const onWarmUp = vi.fn();
    render(<FilterButton count={0} onClick={onClick} onWarmUp={onWarmUp} />);
    const button = screen.getByRole("button");
    fireEvent.pointerDown(button);
    fireEvent.focus(button);
    expect(onWarmUp).toHaveBeenCalledTimes(2);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("hands its element to the ref, for the sheet to give the focus back to", () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<FilterButton count={0} onClick={() => {}} ref={ref} />);
    expect(ref.current).toBe(screen.getByRole("button"));
  });
});

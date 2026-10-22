import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KanzaBrand } from "./kanza-brand";

// `next/font` only works inside Next's compiler, so the font module is replaced by its shape.
vi.mock("./brand-font", () => ({ brandFont: { variable: "brand-font-variable" } }));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

describe("KanzaBrand", () => {
  it("writes the name with the brand font, size and tracking, and the primary color", () => {
    render(<KanzaBrand />);
    const name = screen.getByText("Kanza");
    const classes = name.className.split(/\s+/);
    // `cn()` must not drop `text-brand` (a size) when `text-primary` (a color) is next to it.
    for (const expected of [
      "brand-font-variable",
      "font-brand",
      "text-brand",
      "font-extrabold",
      "tracking-brand",
      "text-primary",
    ]) {
      expect(classes, expected).toContain(expected);
    }
  });

  it("shows the icon as a decorative image: the visible name already says Kanza", () => {
    const { container } = render(<KanzaBrand />);
    const icon = container.querySelector('img[src*="kanza-icon"]');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("alt")).toBe("");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("is 40 px with a 23 px name by default", () => {
    const { container } = render(<KanzaBrand />);
    expect(container.querySelector("img")?.getAttribute("width")).toBe("40");
    const classes = screen.getByText("Kanza").className.split(/\s+/);
    expect(classes).toContain("text-brand");
    expect(classes).not.toContain("text-brand-compact");
  });

  it("is 36 px with a 22 px name in the compact size, keeping the font size next to a color", () => {
    const { container } = render(<KanzaBrand size="compact" tone="sidebar" />);
    expect(container.querySelector("img")?.getAttribute("width")).toBe("36");
    const classes = screen.getByText("Kanza").className.split(/\s+/);
    expect(classes).toContain("text-brand-compact");
    expect(classes).toContain("text-sidebar-primary");
    expect(classes).not.toContain("text-primary");
    expect(classes).not.toContain("text-brand");
  });
});

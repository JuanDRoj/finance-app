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
});

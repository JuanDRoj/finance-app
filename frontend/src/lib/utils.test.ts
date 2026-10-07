import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("lets the last conflicting class win", () => {
    expect(cn("px-4", "px-2")).toBe("px-2");
    expect(cn("text-foreground", "text-primary")).toBe("text-primary");
    expect(cn("px-4", "pl-11")).toBe("px-4 pl-11");
  });

  it("keeps the font size token `text-brand` next to a text color (the Kanza name)", () => {
    expect(cn("font-brand text-brand text-primary")).toBe("font-brand text-brand text-primary");
    expect(cn("text-primary text-brand")).toBe("text-primary text-brand");
  });

  it("still lets a font size override another font size, tokens included", () => {
    expect(cn("text-2xl", "text-brand")).toBe("text-brand");
    expect(cn("text-brand", "text-2xl")).toBe("text-2xl");
  });

  it("resolves the custom tracking token against Tailwind's", () => {
    expect(cn("tracking-brand", "tracking-tight")).toBe("tracking-tight");
    expect(cn("tracking-tight", "tracking-brand")).toBe("tracking-brand");
  });

  it("resolves the custom radius tokens against each other and Tailwind's", () => {
    expect(cn("rounded-tile", "rounded-field")).toBe("rounded-field");
    expect(cn("rounded-tile", "rounded-full")).toBe("rounded-full");
    expect(cn("rounded-full", "rounded-icon")).toBe("rounded-icon");
    // A radius never removes a color, a size or a tracking.
    expect(cn("rounded-tile text-primary tracking-brand p-4")).toBe(
      "rounded-tile text-primary tracking-brand p-4",
    );
  });

  it("keeps font families and weights apart", () => {
    expect(cn("font-brand", "font-extrabold")).toBe("font-brand font-extrabold");
    expect(cn("font-heading", "font-bold")).toBe("font-heading font-bold");
  });
});

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

  it("resolves the custom shadow token against Tailwind's, and keeps it apart from a color", () => {
    expect(cn("shadow-md", "shadow-tooltip")).toBe("shadow-tooltip");
    expect(cn("shadow-tooltip", "shadow-md")).toBe("shadow-md");
    expect(cn("shadow-tooltip bg-tooltip text-tooltip-foreground")).toBe(
      "shadow-tooltip bg-tooltip text-tooltip-foreground",
    );
  });

  it("resolves the font size tokens of KAN-41 against Tailwind's and keeps them apart from colors", () => {
    // The screen title: 24 px, then 26 px and 30 px at the breakpoints (different variants).
    expect(cn("text-2xl", "md:text-title-tablet", "lg:text-title-desktop")).toBe(
      "text-2xl md:text-title-tablet lg:text-title-desktop",
    );
    expect(cn("text-title-tablet", "text-title-desktop")).toBe("text-title-desktop");
    expect(cn("text-2xl", "text-title-tablet")).toBe("text-title-tablet");
    expect(cn("text-title-tablet", "text-2xl")).toBe("text-2xl");
    // The avatar's and the tooltip's sizes next to a text color: both stay.
    expect(cn("text-sm", "md:text-avatar", "md:text-secondary-foreground")).toBe(
      "text-sm md:text-avatar md:text-secondary-foreground",
    );
    expect(cn("text-tooltip-label", "text-tooltip-foreground")).toBe(
      "text-tooltip-label text-tooltip-foreground",
    );
    expect(cn("text-xs", "text-tooltip-label")).toBe("text-tooltip-label");
  });

  it("resolves the title tracking token against Tailwind's", () => {
    expect(cn("tracking-title", "tracking-tight")).toBe("tracking-tight");
    expect(cn("tracking-tight", "tracking-title")).toBe("tracking-title");
    expect(cn("tracking-title", "tracking-brand")).toBe("tracking-brand");
  });

  it("resolves the tooltip radius token against Tailwind's and keeps it apart from other groups", () => {
    expect(cn("rounded-tooltip", "rounded-full")).toBe("rounded-full");
    expect(cn("rounded-full", "rounded-tooltip")).toBe("rounded-tooltip");
    expect(cn("rounded-tile", "rounded-tooltip")).toBe("rounded-tooltip");
    // A one-sided radius does not remove the others, a color or a size.
    expect(cn("rounded-icon", "rounded-r-tooltip")).toBe("rounded-icon rounded-r-tooltip");
    expect(cn("rounded-r-lg", "rounded-r-tooltip")).toBe("rounded-r-tooltip");
    expect(cn("rounded-tooltip bg-tooltip text-tooltip-label")).toBe(
      "rounded-tooltip bg-tooltip text-tooltip-label",
    );
  });

  it("resolves the font size tokens of KAN-69 against Tailwind's and keeps them apart from colors", () => {
    // The label of the bottom bar: 11 px, then 12 px from 768 px (a different variant).
    expect(cn("text-nav-label", "md:text-xs")).toBe("text-nav-label md:text-xs");
    expect(cn("text-xs", "text-nav-label")).toBe("text-nav-label");
    expect(cn("text-nav-label", "text-xs")).toBe("text-xs");
    expect(cn("text-nav-label", "text-primary")).toBe("text-nav-label text-primary");
    // The title of an item (15 px) and the compact Kanza name (22 px).
    expect(cn("text-sm", "text-item")).toBe("text-item");
    expect(cn("text-item", "text-sidebar-primary")).toBe("text-item text-sidebar-primary");
    expect(cn("text-brand", "text-brand-compact")).toBe("text-brand-compact");
    expect(cn("text-brand-compact", "text-sidebar-primary")).toBe(
      "text-brand-compact text-sidebar-primary",
    );
    // The secondary text at 13 px, next to a color and apart from the tooltip's own 13 px token.
    expect(cn("text-xs", "text-caption")).toBe("text-caption");
    expect(cn("text-caption", "text-sm")).toBe("text-sm");
    expect(cn("text-caption", "text-sidebar-foreground")).toBe(
      "text-caption text-sidebar-foreground",
    );
    expect(cn("text-caption", "text-tooltip-label")).toBe("text-tooltip-label");
  });

  it("resolves the shadow tokens of the bottom bar against Tailwind's and keeps them apart from colors", () => {
    expect(cn("shadow-md", "shadow-nav")).toBe("shadow-nav");
    expect(cn("shadow-nav", "shadow-md")).toBe("shadow-md");
    expect(cn("shadow-fab", "shadow-nav")).toBe("shadow-nav");
    expect(cn("shadow-fab bg-primary text-primary-foreground")).toBe(
      "shadow-fab bg-primary text-primary-foreground",
    );
  });

  it("keeps font families and weights apart", () => {
    expect(cn("font-brand", "font-extrabold")).toBe("font-brand font-extrabold");
    expect(cn("font-heading", "font-bold")).toBe("font-heading font-bold");
  });
});

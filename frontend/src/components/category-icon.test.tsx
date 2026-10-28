import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CATEGORY_ICON_NAMES } from "@/lib/core/i18n";
import { CATEGORY_ICONS, CategoryIcon } from "./category-icon";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

/** The `<svg>` a render drew. */
function svgOf(container: HTMLElement) {
  return container.querySelector("svg") as SVGSVGElement;
}

describe("CATEGORY_ICONS", () => {
  // The map is typed with the backend's union of keys, so `npm run typecheck` fails on a missing or
  // an extra key. This is the runtime side: the list the backend publishes today has 66.
  it("has the 66 icons of the backend, each a distinct component", () => {
    const keys = Object.keys(CATEGORY_ICONS);
    expect(keys).toHaveLength(66);
    const components = new Set(Object.values(CATEGORY_ICONS));
    // Every key has its own glyph.
    expect(components.size).toBe(66);
    for (const component of components) expect(component).toBeDefined();
  });

  it("keys are the Phosphor names in kebab-case", () => {
    for (const key of Object.keys(CATEGORY_ICONS)) {
      expect(key).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });

  it("starts with the food icons and ends with the generic ones, in the backend's order", () => {
    const keys = Object.keys(CATEGORY_ICONS);
    expect(keys.slice(0, 3)).toEqual(["fork-knife", "bowl-food", "pizza"]);
    expect(keys.slice(-3)).toEqual(["star", "tag", "dots-three-circle"]);
  });

  it("has a Spanish name for each icon, in the same order (the names live in i18n.ts)", () => {
    expect(Object.keys(CATEGORY_ICON_NAMES)).toEqual(Object.keys(CATEGORY_ICONS));
  });

  it.each(Object.keys(CATEGORY_ICONS))("draws %s as an svg", (key) => {
    const { container } = render(<CategoryIcon icon={key} />);
    expect(svgOf(container)).not.toBeNull();
    cleanup();
  });
});

describe("CategoryIcon", () => {
  it("is decorative: hidden from assistive technology", () => {
    const { container } = render(<CategoryIcon icon="fork-knife" />);
    expect(svgOf(container).getAttribute("aria-hidden")).toBe("true");
  });

  it("is duotone by default and can be regular", () => {
    const duotone = render(<CategoryIcon icon="fork-knife" />);
    // Duotone draws a second, translucent layer.
    expect(svgOf(duotone.container).querySelector("[opacity]")).not.toBeNull();
    cleanup();
    const regular = render(<CategoryIcon icon="fork-knife" weight="regular" />);
    expect(svgOf(regular.container).querySelector("[opacity]")).toBeNull();
  });

  it("passes the class on and never shrinks inside a flex tile", () => {
    const { container } = render(<CategoryIcon icon="car" className="size-5.5" />);
    const classes = svgOf(container).getAttribute("class") ?? "";
    expect(classes).toContain("size-5.5");
    expect(classes).toContain("shrink-0");
  });

  it("draws the generic tag for a key it does not know, never an error", () => {
    const tag = render(<CategoryIcon icon="tag" />);
    const tagMarkup = tag.container.innerHTML;
    cleanup();
    for (const key of ["rocket-ship", ""]) {
      const unknown = render(<CategoryIcon icon={key} />);
      expect(unknown.container.innerHTML).toBe(tagMarkup);
      cleanup();
    }
  });

  it("does not read inherited keys as icons", () => {
    const tag = render(<CategoryIcon icon="tag" />);
    const tagMarkup = tag.container.innerHTML;
    cleanup();
    for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const inherited = render(<CategoryIcon icon={key} />);
      expect(inherited.container.innerHTML).toBe(tagMarkup);
      cleanup();
    }
  });

  it("draws a known key with its own glyph, not the tag", () => {
    const tag = render(<CategoryIcon icon="tag" />);
    const tagMarkup = tag.container.innerHTML;
    cleanup();
    const taxi = render(<CategoryIcon icon="taxi" />);
    expect(taxi.container.innerHTML).not.toBe(tagMarkup);
  });
});

import { cleanup, render, screen } from "@testing-library/react";
import { Tag } from "@phosphor-icons/react/ssr";
import { afterEach, describe, expect, it } from "vitest";
import { MoreList } from "./more-list";
import type { MoreSection } from "./nav-sections";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const CATEGORIES: MoreSection = {
  id: "categories",
  href: "/categorias",
  label: "Categorías",
  icon: Tag,
  description: "Crea, renombra y archiva las tuyas",
};

describe("MoreList", () => {
  it("is the group 'Organiza' with a link per section: title, secondary line and destination", () => {
    render(<MoreList sections={[CATEGORIES]} />);
    expect(screen.getByRole("heading", { level: 2, name: "Organiza" })).toBeTruthy();
    const link = screen.getByRole("link", { name: /Categorías/ });
    expect(link.getAttribute("href")).toBe("/categorias");
    expect(link.textContent).toContain("Crea, renombra y archiva las tuyas");
  });

  it("names the group by its heading", () => {
    render(<MoreList sections={[CATEGORIES]} />);
    const group = screen.getByRole("region", { name: "Organiza" });
    expect(group.querySelectorAll("li")).toHaveLength(1);
  });

  it("makes every row at least 72 px tall and hides the icons from assistive technology", () => {
    render(<MoreList sections={[CATEGORIES]} />);
    const link = screen.getByRole("link", { name: /Categorías/ });
    expect(link.className).toContain("min-h-18");
    // The icon sits in an `aria-hidden` container and the chevron is `aria-hidden` itself.
    for (const icon of link.querySelectorAll("svg")) {
      expect(icon.closest("[aria-hidden='true']")).not.toBeNull();
    }
  });

  it("draws nothing when nothing hangs from Más", () => {
    const { container } = render(<MoreList sections={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("holds a very long title and line without failing", () => {
    const long = "x".repeat(200);
    render(<MoreList sections={[{ ...CATEGORIES, label: long, description: long }]} />);
    expect(screen.getByRole("link").textContent).toContain(long);
  });
});

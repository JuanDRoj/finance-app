import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarNav } from "./sidebar-nav";

// `usePathname` is the only thing of the router the nav reads.
const mocks = vi.hoisted(() => ({ pathname: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: mocks.pathname }));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

beforeEach(() => {
  mocks.pathname.mockReset().mockReturnValue("/");
});

function renderNav() {
  return render(
    <TooltipProvider>
      <SidebarNav />
    </TooltipProvider>,
  );
}

describe("SidebarNav", () => {
  it("is the main navigation, with a link per section named by its label", () => {
    renderNav();
    const nav = screen.getByRole("navigation", { name: "Principal" });
    const links = nav.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Inicio" }).getAttribute("href")).toBe("/");
  });

  it("marks the current section with aria-current and a filled icon", () => {
    renderNav();
    const link = screen.getByRole("link", { name: "Inicio" });
    expect(link.getAttribute("aria-current")).toBe("page");
    // Phosphor draws the `fill` weight as a different path, not as a class; the bar at the left
    // edge is the other cue that does not depend on color.
    expect(link.closest("li")?.querySelector("span[aria-hidden='true']")).not.toBeNull();
  });

  it("marks no section on a path outside the sections", () => {
    mocks.pathname.mockReturnValue("/catalog");
    renderNav();
    const link = screen.getByRole("link", { name: "Inicio" });
    expect(link.getAttribute("aria-current")).toBeNull();
    expect(link.closest("li")?.querySelector("span[aria-hidden='true']")).toBeNull();
  });

  it("hides the icon from assistive technology: the label names the link", () => {
    renderNav();
    const link = screen.getByRole("link", { name: "Inicio" });
    expect(link.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(link.textContent).toBe("");
  });

  it("shows no tooltip until the link is hovered or focused", () => {
    renderNav();
    expect(screen.queryByText("Inicio")).toBeNull();
  });

  it("shows the name in a tooltip when the link gets keyboard focus, and Escape closes it", async () => {
    renderNav();
    const link = screen.getByRole("link", { name: "Inicio" });
    await act(async () => {
      link.focus();
    });
    const tooltip = await screen.findByText("Inicio");
    expect(tooltip.closest("[data-slot='tooltip-content']")).not.toBeNull();

    fireEvent.keyDown(link, { key: "Escape" });
    await vi.waitFor(() => expect(screen.queryByText("Inicio")).toBeNull());
  });
});

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatTile } from "./stat-tile";

// The tile with one figure of the Inicio (FE-24, KAN-84): Disponible, Deuda de tarjetas and, from
// 1024 px, "Gastos de octubre". jsdom has no CSS, so the two looks of the canvas (a column below 1024 px,
// a row from there) are read in the classes.

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

function icon() {
  return <svg data-testid="icon" aria-hidden="true" />;
}

describe("StatTile", () => {
  it("is a region named by its label, with the amount and the note", () => {
    render(
      <StatTile label="Disponible" icon={icon()} value="$ 128.900,00" note="2 bancos y efectivo" />,
    );
    const tile = screen.getByRole("region", { name: "Disponible" });
    expect(within(tile).getByRole("heading", { level: 2, name: "Disponible" })).toBeTruthy();
    expect(within(tile).getByText("$ 128.900,00")).toBeTruthy();
    expect(within(tile).getByText("2 bancos y efectivo")).toBeTruthy();
  });

  it("has two looks in one markup: a column on a phone and a row from 1024 px", () => {
    render(<StatTile label="Disponible" icon={icon()} value="$ 1,00" />);
    const tile = screen.getByRole("region", { name: "Disponible" });
    // The base is the column (the card's own), and `lg:` turns it into a row with the icon on the left.
    expect(tile.className).toContain("lg:flex-row");
    expect(tile.className).toContain("lg:items-center");
    // The sizes of the canvas: 38 px of icon and 18 px of amount on a phone, 40 and 20 from 768 px,
    // 42 and 24 from 1024 px.
    const iconTile = screen.getByTestId("icon").parentElement as HTMLElement;
    for (const expected of ["size-9.5", "md:size-10", "lg:size-10.5"]) {
      expect(iconTile.className).toContain(expected);
    }
    const amount = within(tile).getByText("$ 1,00");
    for (const expected of [
      "text-lg",
      "md:text-xl",
      "lg:text-2xl",
      "font-heading",
      "tabular-nums",
    ]) {
      expect(amount.className).toContain(expected);
    }
  });

  it("colors the amount and the icon tile with the debt color for the debt tone, and not otherwise", () => {
    const { rerender } = render(
      <StatTile label="Deuda de tarjetas" icon={icon()} value="$ 32.470,00" tone="debt" />,
    );
    expect(screen.getByText("$ 32.470,00").className).toContain("text-debt");
    expect(screen.getByTestId("icon").parentElement?.className).toContain("bg-debt/10");

    rerender(<StatTile label="Deuda de tarjetas" icon={icon()} value="$ 0,00" />);
    expect(screen.getByText("$ 0,00").className).not.toContain("text-debt");
    expect(screen.getByTestId("icon").parentElement?.className).toContain("bg-primary-soft");
    expect(screen.getByTestId("icon").parentElement?.className).not.toContain("bg-debt");
  });

  it("leaves the note out when it is not known, and gives it the classes it is told", () => {
    const { rerender } = render(<StatTile label="Disponible" icon={icon()} value="$ 1,00" />);
    expect(screen.getByRole("region", { name: "Disponible" }).querySelector("p + p")).toBeNull();

    rerender(
      <StatTile
        label="Disponible"
        icon={icon()}
        value="$ 1,00"
        note="1 banco"
        noteClassName="max-md:hidden"
      />,
    );
    expect(screen.getByText("1 banco").className).toContain("max-md:hidden");
  });

  it("holds a skeleton in the place of the amount while it is not there, and marks the tile busy", () => {
    render(<StatTile label="Disponible" icon={icon()} value={undefined} note="2 bancos" />);
    const tile = screen.getByRole("region", { name: "Disponible" });
    expect(tile.getAttribute("aria-busy")).toBe("true");
    expect(tile.querySelector("[data-slot='skeleton']")).not.toBeNull();
    expect(within(tile).queryByText(/\$/)).toBeNull();
  });

  it("is not busy once the amount is there", () => {
    render(<StatTile label="Disponible" icon={icon()} value="$ 1,00" />);
    expect(screen.getByRole("region", { name: "Disponible" }).getAttribute("aria-busy")).toBeNull();
  });

  it("lets an enormous amount wrap instead of overflowing the tile", () => {
    render(
      <StatTile
        label="Disponible"
        icon={icon()}
        value="Más de $ 90.071.992.547.409,91"
        note={"Una nota larguísima ".repeat(8)}
      />,
    );
    expect(screen.getByText("Más de $ 90.071.992.547.409,91").className).toContain("wrap-anywhere");
    // The text column can shrink (`min-w-0`) so a long word does not push the tile wider.
    expect(screen.getByRole("heading", { level: 2 }).parentElement?.className).toContain("min-w-0");
  });

  it("takes the classes the screen gives it, such as hiding itself below 1024 px", () => {
    render(
      <StatTile label="Gastos de octubre" icon={icon()} value="$ 1,00" className="max-lg:hidden" />,
    );
    expect(screen.getByRole("region", { name: "Gastos de octubre" }).className).toContain(
      "max-lg:hidden",
    );
  });
});

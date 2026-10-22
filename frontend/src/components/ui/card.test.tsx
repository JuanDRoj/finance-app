import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Card } from "./card";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

function classesOf(variant?: "glass" | "tile" | "solid") {
  render(<Card variant={variant}>Contenido</Card>);
  return screen.getByText("Contenido").className.split(/\s+/);
}

describe("Card", () => {
  it("is glass by default, as before", () => {
    const classes = classesOf();
    expect(classes).toContain("card-surface");
    expect(classes).toContain("rounded-tile");
    expect(classes).not.toContain("tile-surface");
  });

  it("'tile' is glass below 1024 px and a solid 20 px card from 1024 px", () => {
    const classes = classesOf("tile");
    // The glass-to-surface switch lives in the `tile-surface` utility (tokens.test.ts reads it).
    expect(classes).toContain("tile-surface");
    expect(classes).toContain("rounded-tile");
    expect(classes).toContain("lg:rounded-card");
    expect(classes).toContain("lg:p-6");
    expect(classes).not.toContain("card-surface");
  });

  it("'solid' stays the opaque form surface", () => {
    const classes = classesOf("solid");
    expect(classes).toContain("bg-card-solid");
    expect(classes).not.toContain("tile-surface");
  });
});

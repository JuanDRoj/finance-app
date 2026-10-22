import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buttonVariants } from "./button-variants";

const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

// A Server Component (the first-use card of the Inicio) gives a link the look of a button. A
// function exported from a "use client" module cannot be called on the server: Next.js fails at
// render time, which no unit test sees (they do not draw the client boundary). So the module
// that holds the classes must stay free of the directive, and `button.tsx` must not be a way
// around it.
describe("buttonVariants", () => {
  it("lives in a module that is not a client module", () => {
    expect(read("./button-variants.ts")).not.toMatch(/^\s*["']use client["']/m);
  });

  it("is not re-exported by the client module of the Button", () => {
    const button = read("./button.tsx");
    expect(button).toMatch(/^"use client"/);
    expect(button).not.toMatch(/export\s*\{[^}]*buttonVariants/);
    expect(button).not.toMatch(/export const buttonVariants/);
  });

  it("gives a link the size of a button: 52 px by default and at least 44 px small", () => {
    expect(buttonVariants()).toContain("min-h-13");
    expect(buttonVariants({ size: "sm" })).toContain("min-h-11");
    expect(buttonVariants({ size: "icon" })).toContain("size-11");
  });

  it("keeps the project's focus ring", () => {
    expect(buttonVariants()).toContain("focus-visible:outline-solid");
  });
});

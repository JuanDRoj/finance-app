import { describe, expect, it } from "vitest";
import { NAV_SECTIONS, isSectionActive } from "./nav-sections";

describe("isSectionActive", () => {
  it("makes the home active only on `/`", () => {
    expect(isSectionActive("/", "/")).toBe(true);
    expect(isSectionActive("/catalog", "/")).toBe(false);
    expect(isSectionActive("/movimientos", "/")).toBe(false);
  });

  it("makes a section active on its own path and on every path below it", () => {
    expect(isSectionActive("/movimientos", "/movimientos")).toBe(true);
    expect(isSectionActive("/movimientos/abc", "/movimientos")).toBe(true);
    expect(isSectionActive("/movimientos/abc/editar", "/movimientos")).toBe(true);
  });

  it("compares whole segments: a longer name that starts the same is another section", () => {
    expect(isSectionActive("/movimientos-viejos", "/movimientos")).toBe(false);
    expect(isSectionActive("/catalogo", "/catalog")).toBe(false);
  });

  it("does not make a section active from a parent path", () => {
    expect(isSectionActive("/", "/movimientos")).toBe(false);
    expect(isSectionActive("/cuentas", "/cuentas/nueva")).toBe(false);
  });
});

describe("NAV_SECTIONS", () => {
  it("has only Inicio in Hito 0", () => {
    expect(NAV_SECTIONS.map((section) => [section.id, section.href, section.label])).toEqual([
      ["home", "/", "Inicio"],
    ]);
  });

  it("gives every section a distinct id and href, and an href that starts with a slash", () => {
    expect(new Set(NAV_SECTIONS.map((section) => section.id)).size).toBe(NAV_SECTIONS.length);
    expect(new Set(NAV_SECTIONS.map((section) => section.href)).size).toBe(NAV_SECTIONS.length);
    for (const section of NAV_SECTIONS) expect(section.href.startsWith("/")).toBe(true);
  });
});

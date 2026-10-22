import { describe, expect, it } from "vitest";
import {
  MORE_ITEM,
  MORE_SECTIONS,
  NAV,
  NAV_SECTIONS,
  PRIMARY_ACTION,
  barItems,
  isMoreActive,
  isSectionActive,
  splitAroundAction,
  type MoreSection,
  type NavSection,
} from "./nav-sections";

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
  // Only the sections whose screen exists are listed (no link may lead to a 404). Whoever builds
  // Movimientos or Cuentas adds its entry and changes this test.
  it("has only Inicio until the other screens exist", () => {
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

describe("what the navigation shows today", () => {
  it("has nothing in Más and no main action until their screens exist", () => {
    expect(MORE_SECTIONS).toEqual([]);
    expect(PRIMARY_ACTION).toBeNull();
    expect(NAV).toEqual({ sections: NAV_SECTIONS, more: MORE_SECTIONS, action: PRIMARY_ACTION });
  });

  it("keeps the 'Más' tab pointing at /mas", () => {
    expect(MORE_ITEM).toMatchObject({ id: "more", href: "/mas", label: "Más" });
  });
});

const icon = NAV_SECTIONS[0]!.icon;
const section = (id: string, href: string, label: string): NavSection => ({
  id,
  href,
  label,
  icon,
});
const HOME = section("home", "/", "Inicio");
const TRANSACTIONS = section("transactions", "/movimientos", "Movimientos");
const ACCOUNTS = section("accounts", "/cuentas", "Cuentas");
const CATEGORIES: MoreSection = {
  ...section("categories", "/categorias", "Categorías"),
  description: "Crea, renombra y archiva las tuyas",
};

describe("isMoreActive", () => {
  it("is active on /mas and below it", () => {
    expect(isMoreActive("/mas", [])).toBe(true);
    expect(isMoreActive("/mas/algo", [])).toBe(true);
  });

  it("is active on every screen that hangs from Más, by whole segments", () => {
    expect(isMoreActive("/categorias", [CATEGORIES])).toBe(true);
    expect(isMoreActive("/categorias/abc", [CATEGORIES])).toBe(true);
    expect(isMoreActive("/categorias-viejas", [CATEGORIES])).toBe(false);
  });

  it("is not active elsewhere, nor on /masivo (not a segment of /mas)", () => {
    expect(isMoreActive("/", [CATEGORIES])).toBe(false);
    expect(isMoreActive("/cuentas", [CATEGORIES])).toBe(false);
    expect(isMoreActive("/masivo", [CATEGORIES])).toBe(false);
  });
});

describe("barItems", () => {
  it("shows the sections alone while nothing hangs from Más", () => {
    expect(barItems([HOME, ACCOUNTS], []).map((item) => item.id)).toEqual(["home", "accounts"]);
  });

  it("adds the 'Más' tab at the end once something hangs from it", () => {
    expect(barItems([HOME, TRANSACTIONS, ACCOUNTS], [CATEGORIES]).map((item) => item.id)).toEqual([
      "home",
      "transactions",
      "accounts",
      "more",
    ]);
  });

  it("does not change the list it is given", () => {
    const sections = [HOME];
    barItems(sections, [CATEGORIES]);
    expect(sections).toEqual([HOME]);
  });
});

describe("splitAroundAction", () => {
  it("puts the + in the middle: two and two with the four tabs of the end of Hito 1", () => {
    expect(splitAroundAction(["a", "b", "c", "d"])).toEqual({
      before: ["a", "b"],
      after: ["c", "d"],
    });
  });

  it("gives the extra tab to the left side when the count is odd", () => {
    expect(splitAroundAction(["a", "b", "c"])).toEqual({ before: ["a", "b"], after: ["c"] });
    expect(splitAroundAction(["a"])).toEqual({ before: ["a"], after: [] });
  });

  it("works with nothing, and with two", () => {
    expect(splitAroundAction([])).toEqual({ before: [], after: [] });
    expect(splitAroundAction(["a", "b"])).toEqual({ before: ["a"], after: ["b"] });
  });
});

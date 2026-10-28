import { describe, expect, it } from "vitest";
import {
  editCategoryPageHref,
  editCategoryPanelHref,
  newCategoryPageHref,
  newCategoryPanelHref,
} from "./category-urls";

describe("the pages of the forms (below 1024 px)", () => {
  it("is /categorias/nueva, with the kind and the principal only when there are", () => {
    expect(newCategoryPageHref()).toBe("/categorias/nueva");
    expect(newCategoryPageHref({ kind: "income" })).toBe("/categorias/nueva?tipo=ingresos");
    expect(newCategoryPageHref({ parentId: "p1" })).toBe("/categorias/nueva?padre=p1");
    expect(newCategoryPageHref({ kind: "expense", parentId: "p1" })).toBe(
      "/categorias/nueva?tipo=gastos&padre=p1",
    );
  });

  it("is /categorias/<id> for an existing one, with the id safe in a path", () => {
    expect(editCategoryPageHref("abc")).toBe("/categorias/abc");
    expect(editCategoryPageHref("a/b?c")).toBe("/categorias/a%2Fb%3Fc");
  });
});

describe("the panels over the list (from 1024 px)", () => {
  it("is ?categoria=nueva with the same kind and principal", () => {
    expect(newCategoryPanelHref()).toBe("/categorias?categoria=nueva");
    expect(newCategoryPanelHref({ kind: "income", parentId: "p1" })).toBe(
      "/categorias?categoria=nueva&tipo=ingresos&padre=p1",
    );
  });

  it("is ?categoria=editar&id=<id> for an existing one", () => {
    expect(editCategoryPanelHref("abc")).toBe("/categorias?categoria=editar&id=abc");
    expect(editCategoryPanelHref("a&b")).toBe("/categorias?categoria=editar&id=a%26b");
  });
});

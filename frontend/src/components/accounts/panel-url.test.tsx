import { afterEach, describe, expect, it } from "vitest";
import {
  CATEGORY_PANEL,
  CATEGORY_PANEL_COMPANIONS,
  MOVEMENT_PANEL,
  NEW_ACCOUNT_PANEL,
  categoryEditPanel,
  closePanelInUrl,
  openPanelInUrl,
  replacePanelInUrl,
} from "./panel-url";

afterEach(() => window.history.replaceState(null, "", "/"));

describe("the panel in the URL", () => {
  it("names the new account's panel ?cuenta=nueva, as PRIMARY_ACTION says", () => {
    expect(NEW_ACCOUNT_PANEL).toEqual({ param: "cuenta", value: "nueva" });
  });

  it("opens by adding the param to the current path, keeping the rest", () => {
    window.history.replaceState(null, "", "/movimientos?mes=2026-10#tabla");
    openPanelInUrl(NEW_ACCOUNT_PANEL);
    expect(window.location.pathname).toBe("/movimientos");
    expect(window.location.search).toBe("?mes=2026-10&cuenta=nueva");
    expect(window.location.hash).toBe("#tabla");
  });

  it("opens once: asking again does not repeat the param", () => {
    openPanelInUrl(NEW_ACCOUNT_PANEL);
    openPanelInUrl(NEW_ACCOUNT_PANEL);
    expect(window.location.search).toBe("?cuenta=nueva");
  });

  it("closes by taking only that param out", () => {
    window.history.replaceState(null, "", "/?mes=2026-10&cuenta=nueva");
    closePanelInUrl("cuenta");
    expect(window.location.search).toBe("?mes=2026-10");
    closePanelInUrl("cuenta");
    expect(window.location.search).toBe("?mes=2026-10");
  });

  it("leaves a clean URL when it was the only param", () => {
    openPanelInUrl(NEW_ACCOUNT_PANEL);
    closePanelInUrl("cuenta");
    expect(window.location.pathname + window.location.search).toBe("/");
  });

  it("adds no history entries: opening and closing replace the current one", () => {
    const before = window.history.length;
    openPanelInUrl(NEW_ACCOUNT_PANEL);
    closePanelInUrl("cuenta");
    expect(window.history.length).toBe(before);
  });

  it("names the panel of a movement ?movimiento=nuevo, as PRIMARY_ACTION says", () => {
    expect(MOVEMENT_PANEL).toEqual({ param: "movimiento", value: "nuevo" });
  });

  it("swaps one panel for another in one write, keeping the rest of the URL", () => {
    window.history.replaceState(null, "", "/cuentas?sel=abc&movimiento=nuevo#lista");
    replacePanelInUrl("movimiento", NEW_ACCOUNT_PANEL);
    expect(window.location.pathname).toBe("/cuentas");
    expect(window.location.search).toBe("?sel=abc&cuenta=nueva");
    expect(window.location.hash).toBe("#lista");
  });

  it("swaps even if the panel to leave was not in the URL, and adds no history entries", () => {
    const before = window.history.length;
    replacePanelInUrl("movimiento", NEW_ACCOUNT_PANEL);
    expect(window.location.search).toBe("?cuenta=nueva");
    expect(window.history.length).toBe(before);
  });
});

describe("the panel of a category (KAN-77)", () => {
  it("names the panel ?categoria=nueva, and the edit panel ?categoria=editar with the id", () => {
    expect(CATEGORY_PANEL).toEqual({ param: "categoria", value: "nueva" });
    expect(categoryEditPanel("abc")).toEqual({
      param: "categoria",
      value: "editar",
      extra: { id: "abc" },
    });
  });

  it("writes the params that go with the panel in the same write, keeping the rest", () => {
    window.history.replaceState(null, "", "/categorias?tipo=ingresos#lista");
    const before = window.history.length;
    openPanelInUrl({ ...CATEGORY_PANEL, extra: { padre: "p1", tipo: "ingresos" } });
    expect(window.location.pathname).toBe("/categorias");
    expect(window.location.search).toBe("?tipo=ingresos&categoria=nueva&padre=p1");
    expect(window.location.hash).toBe("#lista");
    expect(window.history.length).toBe(before);
  });

  it("opens the edit panel with its id", () => {
    window.history.replaceState(null, "", "/categorias");
    openPanelInUrl(categoryEditPanel("abc"));
    expect(window.location.search).toBe("?categoria=editar&id=abc");
  });

  it("opens without extra params as it always did", () => {
    openPanelInUrl(NEW_ACCOUNT_PANEL);
    expect(window.location.search).toBe("?cuenta=nueva");
  });

  it("closes the panel and its companions at once, and leaves the tab of the list", () => {
    window.history.replaceState(
      null,
      "",
      "/categorias?tipo=ingresos&categoria=nueva&padre=p1&id=x#lista",
    );
    closePanelInUrl("categoria", ...CATEGORY_PANEL_COMPANIONS);
    expect(window.location.search).toBe("?tipo=ingresos");
    expect(window.location.hash).toBe("#lista");
  });

  it("closes cleanly when the companions are not there", () => {
    window.history.replaceState(null, "", "/categorias?categoria=editar&id=abc");
    closePanelInUrl("categoria", ...CATEGORY_PANEL_COMPANIONS);
    expect(window.location.pathname + window.location.search).toBe("/categorias");
  });
});

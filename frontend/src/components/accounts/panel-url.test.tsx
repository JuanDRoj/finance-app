import { afterEach, describe, expect, it } from "vitest";
import {
  MOVEMENT_PANEL,
  NEW_ACCOUNT_PANEL,
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

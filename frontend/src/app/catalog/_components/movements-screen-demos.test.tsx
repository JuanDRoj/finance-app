import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MovementsScreenDemo,
  crowdedMonth,
  emptyMonthMovements,
  faultFor,
  historyMovements,
} from "./movements-screen-demos";
import { worstMovements } from "./movement-pieces-demos";

// The demo runs the real screen against a scripted backend. This keeps the script honest: if the
// screen changes the calls it makes, or the datasets drift from what the break-ui pass names, it
// fails here.
vi.mock("next/navigation", () => ({
  useSearchParams: () => {
    const search = useSyncExternalStore(
      (notify) => {
        window.addEventListener("test-url-changed", notify);
        return () => window.removeEventListener("test-url-changed", notify);
      },
      () => window.location.search,
      () => "",
    );
    return new URLSearchParams(search);
  },
}));

const replaceState = window.history.replaceState.bind(window.history);

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  window.history.replaceState = (...args: Parameters<History["replaceState"]>) => {
    replaceState(...args);
    window.dispatchEvent(new Event("test-url-changed"));
  };
});

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState = replaceState;
  replaceState(null, "", "/");
});

const choose = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("the datasets", () => {
  it("has three months of movements, newest first, each with its own id", () => {
    const items = historyMovements();
    expect(new Set(items.map((item) => item.date.slice(0, 7)))).toEqual(
      new Set(["2026-10", "2026-09", "2026-08"]),
    );
    const dates = items.map((item) => item.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });

  it("has an empty October with September and August behind it", () => {
    const items = emptyMonthMovements();
    expect(items.length).toBeGreaterThan(10);
    expect(items.some((item) => item.date.startsWith("2026-10"))).toBe(false);
  });

  it("has 500 movements in October, ten pages of 50, newest first, each with its own id", () => {
    const items = crowdedMonth();
    expect(items).toHaveLength(500);
    expect(items.every((item) => item.date.startsWith("2026-10"))).toBe(true);
    expect(new Set(items.map((item) => item.id)).size).toBe(500);
    const dates = items.map((item) => item.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});

describe("faultFor", () => {
  const call = (kind: "list" | "next-page" | "summary") => ({ kind, path: "/x", query: {} });

  it("fails the list as the select says, and nothing else", () => {
    expect(faultFor({ load: "ok", next: "ok" }, call("list"), 0)).toBeUndefined();
    expect(faultFor({ load: "loading", next: "ok" }, call("list"), 0)).toBe("never");
    expect(faultFor({ load: "error", next: "ok" }, call("list"), 0)).toBe("server");
    expect(faultFor({ load: "offline", next: "ok" }, call("list"), 0)).toBe("offline");
    expect(faultFor({ load: "error", next: "ok" }, call("summary"), 0)).toBeUndefined();
    expect(faultFor({ load: "error", next: "ok" }, call("next-page"), 0)).toBeUndefined();
  });

  it("fails a refresh only after a first list came out well", () => {
    expect(faultFor({ load: "refresh", next: "ok" }, call("list"), 0)).toBeUndefined();
    expect(faultFor({ load: "refresh", next: "ok" }, call("list"), 1)).toBe("server");
  });

  it("fails the next page as the select says", () => {
    expect(faultFor({ load: "ok", next: "offline" }, call("next-page"), 0)).toBe("offline");
    expect(faultFor({ load: "ok", next: "cursor" }, call("next-page"), 0)).toBe("cursor");
    expect(faultFor({ load: "ok", next: "invalid" }, call("next-page"), 0)).toBe("invalid");
    expect(faultFor({ load: "ok", next: "slow" }, call("next-page"), 0)).toBeUndefined();
    expect(faultFor({ load: "ok", next: "offline" }, call("list"), 0)).toBeUndefined();
  });

  it("fails the summary of the filters when asked, and not the total of the whole space", () => {
    const settings = { load: "ok", next: "ok", summary: "error" } as const;
    expect(faultFor(settings, call("summary"), 0)).toBe("server");
    expect(faultFor(settings, { kind: "total", path: "/x", query: {} }, 0)).toBeUndefined();
    expect(faultFor(settings, call("list"), 0)).toBeUndefined();
    expect(faultFor({ load: "ok", next: "ok" }, call("summary"), 0)).toBeUndefined();
  });
});

describe("MovementsScreenDemo", () => {
  it("shows the screen with the normal data: the table, the summary and the line under the title", async () => {
    render(<MovementsScreenDemo instant />);
    const table = await screen.findByRole("table", { name: "Movimientos de Octubre 2026" });
    expect(within(table).getByText("Tienda Inglesa")).toBeTruthy();
    expect(await screen.findByRole("region", { name: "Resumen de Octubre 2026" })).toBeTruthy();
    await screen.findByText("Octubre 2026 · 15 movimientos", { selector: "span" });
  });

  it("moves through the months of the history", async () => {
    render(<MovementsScreenDemo instant />);
    await screen.findByRole("table");
    fireEvent.change(screen.getByRole("combobox", { name: "Mes" }), {
      target: { value: "2026-09" },
    });
    await screen.findByRole("table", { name: "Movimientos de Setiembre 2026" });
    expect(window.location.search).toBe("?mes=2026-09");
  });

  it("shows the invitation for a space with no movement, and 'Nueva cuenta' with no active account", async () => {
    render(<MovementsScreenDemo instant />);
    choose("Qué movimientos hay", "none");
    await screen.findByText("Aún no tienes movimientos");
    choose("Qué cuentas hay", "archived");
    await waitFor(() => expect(screen.getByRole("link", { name: "Nueva cuenta" })).toBeTruthy());
  });

  it("shows 'no results' for an empty month with history, and the history one month back", async () => {
    render(<MovementsScreenDemo instant />);
    choose("Qué movimientos hay", "emptyMonth");
    await screen.findByText("No hay movimientos con estos filtros");
    expect(screen.queryByText("Aún no tienes movimientos")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    await screen.findByRole("table", { name: "Movimientos de Setiembre 2026" });
  });

  it("filters by a link's search: ?q=cafe finds 'Café' with no accent", async () => {
    render(<MovementsScreenDemo instant />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Búsqueda ?q=cafe" }));
    expect(window.location.search).toBe("?q=cafe");
    await screen.findByText("Mostrando 1 de 1 movimiento");
    expect(within(screen.getByRole("table")).getByText("Café")).toBeTruthy();
  });

  it("opens on the default view with the nonsense URL", async () => {
    render(<MovementsScreenDemo instant />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Basura en la URL" }));
    await screen.findByRole("table", { name: "Movimientos de Octubre 2026" });
    expect((screen.getByRole("combobox", { name: "Mes" }) as HTMLSelectElement).value).toBe(
      "2026-10",
    );
  });

  it("reaches the edge months with the links", async () => {
    render(<MovementsScreenDemo instant />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Mes 1900-01" }));
    await screen.findByText("No hay movimientos con estos filtros");
    expect(screen.getByRole("button", { name: "Mes anterior" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Mes 2199-12" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Mes siguiente" }).getAttribute("aria-disabled"),
      ).toBe("true"),
    );
  });

  it("shows the loading, the 500 and the offline states of the list", async () => {
    render(<MovementsScreenDemo instant />);
    choose("Cómo carga la lista", "loading");
    expect(await screen.findByRole("status", { name: "Cargando movimientos" })).toBeTruthy();
    choose("Cómo carga la lista", "error");
    expect(await screen.findByText("No se pudieron cargar tus movimientos")).toBeTruthy();
    choose("Cómo carga la lista", "offline");
    expect(await screen.findByText("No se pudieron cargar tus movimientos")).toBeTruthy();
    choose("Cómo carga la lista", "ok");
    expect(await screen.findByRole("table")).toBeTruthy();
  });

  it("says the summary could not be loaded, and gets it back with 'Reintentar'", async () => {
    render(<MovementsScreenDemo instant />);
    choose("Qué responde el resumen", "error");
    await screen.findByText("No se pudo cargar el resumen");
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.queryByRole("region", { name: /Resumen/ })).toBeNull();
    choose("Qué responde el resumen", "ok");
    await screen.findByRole("region", { name: "Resumen de Octubre 2026" });
    expect(screen.queryByText("No se pudo cargar el resumen")).toBeNull();
  });

  it("takes another 422 from the next page without starting the list over", async () => {
    render(<MovementsScreenDemo instant />);
    choose("Qué movimientos hay", "many");
    choose("Qué responde la página siguiente", "invalid");
    await screen.findByText("Mostrando 50 de 500 movimientos");
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    await screen.findByText("No se pudieron cargar más movimientos");
    expect(screen.getByRole("alert").textContent).not.toContain("desde el principio");
  });

  it("keeps the rows and says so when a refresh fails", async () => {
    render(<MovementsScreenDemo instant />);
    choose("Cómo carga la lista", "refresh");
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Refrescar la lista" }));
    await screen.findByText("No se pudo actualizar la lista");
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("pages the 500 movements ten by ten, and the next page can fail", async () => {
    render(<MovementsScreenDemo instant />);
    choose("Qué movimientos hay", "many");
    await screen.findByText("Mostrando 50 de 500 movimientos");
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    await screen.findByText("Mostrando 100 de 500 movimientos");
    choose("Qué responde la página siguiente", "offline");
    await screen.findByText("Mostrando 50 de 500 movimientos");
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    await screen.findByText("No se pudieron cargar más movimientos");
  });

  it("takes the worst data without breaking: no raw null, the largest amount whole", async () => {
    render(<MovementsScreenDemo instant />);
    choose("Qué movimientos hay", "worst");
    await screen.findByRole("table");
    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/\bnull\b|\bundefined\b|\[object/);
    expect(screen.getAllByText("+$ 90.071.992.547.409,91").length).toBeGreaterThan(0);
    expect(worstMovements().length).toBeGreaterThan(100);
    await act(async () => {});
  });

  it("starts again from scratch", async () => {
    render(<MovementsScreenDemo instant />);
    await screen.findByRole("table");
    fireEvent.click(
      within(screen.getByRole("region", { name: "Filtros" })).getByRole("button", {
        name: "Transferencias",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Empezar de nuevo" }));
    await screen.findByRole("table");
  });
});

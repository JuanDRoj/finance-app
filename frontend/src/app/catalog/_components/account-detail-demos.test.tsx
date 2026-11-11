import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listTransactions, getTransactionsSummary } from "@/lib/core/data/transactions";
import {
  AccountDetailDemo,
  canvasMovements,
  crowdedMovements,
  demoApi,
  emptyMonthMovements,
  faultFor,
  worstMovements,
} from "./account-detail-demos";
import { uuidOf, withUuids } from "./movement-filter-lists";
import { NAME_80, TEXT_200 } from "./movement-pieces-demos";

// The demo runs the real screen against a scripted backend that also sends the balance after each
// movement. This keeps the script honest: if the screen changes the calls it makes, or the datasets
// drift from what the canvas and the break-ui pass name, it fails here.
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }),
  usePathname: () => "/catalog",
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
  mocks.refresh.mockReset();
  // The detail asks for its movements only from 1024 px: the window is as wide as that.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
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

const SPACE = "00000000-0000-4000-8000-000000000000";
const ITAU = () => uuidOf("d-itau");
const VISA = () => uuidOf("d-visa");

describe("the datasets", () => {
  it("has the canvas's October and a September, newest first, each movement with its own id", () => {
    const items = canvasMovements();
    expect(new Set(items.map((item) => item.date.slice(0, 7)))).toEqual(
      new Set(["2026-10", "2026-09", "2026-08"]),
    );
    const dates = items.map((item) => item.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });

  it("adds up, for every account, to the balance the canvas shows", async () => {
    const api = demoApi({ data: "canvas", load: "ok", summary: "ok", next: "ok", instant: true });
    const accounts = (await api.GET("/spaces/{space_id}/accounts", {
      params: { path: { space_id: SPACE } },
    } as never)) as { data: { name: string; balance_minor: number }[] };
    const balances = Object.fromEntries(accounts.data.map((a) => [a.name, a.balance_minor]));
    expect(balances).toEqual({
      Itaú: 8425000,
      "BROU Caja de ahorro": 3915000,
      Efectivo: 550000,
      "Visa Itaú": -2412000,
    });
  });

  it("has an empty October with September behind it", () => {
    const items = emptyMonthMovements();
    expect(items.length).toBeGreaterThan(5);
    expect(items.some((item) => item.date.startsWith("2026-10"))).toBe(false);
  });

  it("has 500 more movements of Itaú in October, newest first, each with its own id", () => {
    const items = crowdedMovements();
    expect(items.length).toBe(canvasMovements().length + 500);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    const dates = items.map((item) => item.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("reaches the limits of the backend in the worst case", () => {
    const items = worstMovements();
    const texts = items.flatMap((item) => [
      item.description ?? "",
      item.account?.name ?? "",
      item.category?.name ?? "",
      item.category?.parent?.name ?? "",
    ]);
    expect(texts).toContain(TEXT_200);
    expect(texts).toContain(NAME_80);
    expect(texts).toContain("x".repeat(200));
    expect(texts.some((text) => /[؀-ۿ]/.test(text))).toBe(true);
    expect(texts.some((text) => /\p{Extended_Pictographic}/u.test(text))).toBe(true);
    expect(items.some((item) => Math.abs(item.amount_minor) === Number.MAX_SAFE_INTEGER)).toBe(
      true,
    );
    expect(items.some((item) => item.status === "pending")).toBe(true);
    expect(items.some((item) => item.status === "skipped")).toBe(true);
    expect(items.some((item) => item.description === null)).toBe(true);
  });

  it("keeps the running balance of the worst case inside the safe integers, as the backend demands", async () => {
    const api = demoApi({ data: "worst", load: "ok", summary: "ok", next: "ok", instant: true });
    const accountId = uuidOf("d-w-long");
    const page = await listTransactions(api, SPACE, { accountId, month: "2026-10" });
    expect(page.items.length).toBeGreaterThan(3);
    for (const item of page.items) {
      if (item.balance_after_minor !== null) {
        expect(Math.abs(item.balance_after_minor)).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
      }
    }
  });
});

describe("faultFor", () => {
  const call = (kind: "list" | "next-page" | "summary" | "accounts") => ({
    kind,
    path: "/x",
    query: {},
  });
  const ok = { load: "ok", summary: "ok", next: "ok" } as const;

  it("fails the list as the select says, and nothing else", () => {
    expect(faultFor(ok, call("list"), 0)).toBeUndefined();
    expect(faultFor({ ...ok, load: "loading" }, call("list"), 0)).toBe("never");
    expect(faultFor({ ...ok, load: "error" }, call("list"), 0)).toBe("server");
    expect(faultFor({ ...ok, load: "offline" }, call("list"), 0)).toBe("offline");
    expect(faultFor({ ...ok, load: "error" }, call("summary"), 0)).toBeUndefined();
    expect(faultFor({ ...ok, load: "error" }, call("accounts"), 0)).toBeUndefined();
  });

  it("fails only a refresh when the first list has answered", () => {
    const refresh = { ...ok, load: "refresh" } as const;
    expect(faultFor(refresh, call("list"), 0)).toBeUndefined();
    expect(faultFor(refresh, call("list"), 1)).toBe("server");
  });

  it("fails the summary and the next page as their selects say", () => {
    expect(faultFor({ ...ok, summary: "error" }, call("summary"), 0)).toBe("server");
    expect(faultFor({ ...ok, summary: "slow" }, call("summary"), 0)).toBeUndefined();
    expect(faultFor({ ...ok, next: "offline" }, call("next-page"), 0)).toBe("offline");
    expect(faultFor({ ...ok, next: "cursor" }, call("next-page"), 0)).toBe("cursor");
    expect(faultFor({ ...ok, next: "invalid" }, call("next-page"), 0)).toBe("invalid");
    expect(faultFor({ ...ok, next: "slow" }, call("next-page"), 0)).toBeUndefined();
  });
});

describe("the backend of the demo", () => {
  const api = () =>
    demoApi({ data: "canvas", load: "ok", summary: "ok", next: "ok", instant: true });

  it("sends the balance after each movement of the account, the running sum of its whole history", async () => {
    const page = await listTransactions(api(), SPACE, { accountId: ITAU(), month: "2026-10" });
    expect(page.items.map((item) => [item.description, item.balance_after_minor])).toEqual([
      ["Gimnasio", null],
      ["Uber", 8425000],
      ["Pago de Visa Itaú", 8463000],
      ["UTE", 10313000],
      ["Antel", 10528000],
      ["Sueldo", 10690000],
    ]);
  });

  it("does not change the balance with the type: a movement the filter hides still moved it", async () => {
    const page = await listTransactions(api(), SPACE, {
      accountId: ITAU(),
      month: "2026-10",
      type: "income",
    });
    expect(page.items.map((item) => [item.description, item.balance_after_minor])).toEqual([
      ["Sueldo", 10690000],
    ]);
  });

  it("sends the debt of a card as a negative balance", async () => {
    const page = await listTransactions(api(), SPACE, { accountId: VISA(), month: "2026-10" });
    expect(page.items[0]).toMatchObject({
      description: "Tienda Inglesa",
      balance_after_minor: -2412000,
    });
  });

  it("sends the balance change of the month with the account, as the canvas's net movement", async () => {
    const summary = await getTransactionsSummary(api(), SPACE, {
      accountId: ITAU(),
      month: "2026-10",
    });
    expect(summary.balance_change_minor).toBe(4535000);
    const card = await getTransactionsSummary(api(), SPACE, {
      accountId: VISA(),
      month: "2026-10",
    });
    expect(card.expense_minor).toBe(458000);
  });

  it("answers 404 for the space of someone else, and a summary with no balance change when asked to", async () => {
    const notFound = demoApi({
      data: "canvas",
      load: "notFound",
      summary: "ok",
      next: "ok",
      instant: true,
    });
    await expect(
      listTransactions(notFound, SPACE, { accountId: ITAU(), month: "2026-10" }),
    ).rejects.toMatchObject({ status: 404 });
    const noChange = demoApi({
      data: "canvas",
      load: "ok",
      summary: "noChange",
      next: "ok",
      instant: true,
    });
    const summary = await getTransactionsSummary(noChange, SPACE, {
      accountId: ITAU(),
      month: "2026-10",
    });
    expect(summary.balance_change_minor).toBeUndefined();
  });

  it("works with the movements as the backend sends them: ids that are UUIDs", () => {
    for (const item of withUuids(canvasMovements())) {
      expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});

describe("AccountDetailDemo", () => {
  it("shows the detail of the first account with its figure and its table", async () => {
    render(<AccountDetailDemo instant />);
    const detail = await screen.findByRole("region", { name: "Itaú" });
    const table = await within(detail).findByRole("table");
    expect(within(table).getByText("Uber")).toBeTruthy();
    const figure = within(detail).getByText("Movimiento neto de octubre").parentElement!;
    await waitFor(() => expect(figure.textContent).toContain("+$\u00A045.350,00"));
  });

  it("shows a card as debt when the link of the Visa writes ?sel in the address", async () => {
    render(<AccountDetailDemo instant />);
    await screen.findByRole("region", { name: "Itaú" });
    fireEvent.click(screen.getByRole("button", { name: "Visa Itaú" }));
    const detail = await screen.findByRole("region", { name: "Visa Itaú" });
    const table = await within(detail).findByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Deuda" })).toBeTruthy();
    expect(window.location.search).toBe(`?sel=${VISA()}`);
    await waitFor(() =>
      expect(within(detail).getByText("Consumos de octubre").parentElement!.textContent).toContain(
        "$\u00A04.580,00",
      ),
    );
  });

  it("starts the screen again when a select changes what goes wrong", async () => {
    render(<AccountDetailDemo instant />);
    await screen.findByRole("region", { name: "Itaú" });
    fireEvent.change(screen.getByLabelText("Cómo carga la lista de la cuenta"), {
      target: { value: "error" },
    });
    expect(
      await screen.findByText("No se pudieron cargar los movimientos de esta cuenta"),
    ).toBeTruthy();
  });

  it("shows the empty month of the dataset that has one", async () => {
    render(<AccountDetailDemo instant />);
    await screen.findByRole("region", { name: "Itaú" });
    fireEvent.change(screen.getByLabelText("Qué movimientos hay"), {
      target: { value: "emptyMonth" },
    });
    expect(await screen.findByText("Esta cuenta no tiene movimientos este mes")).toBeTruthy();
  });
});

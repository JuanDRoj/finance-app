import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardRead } from "@/lib/core/data/dashboard";
import { TopExpensesCard } from "./top-expenses";
import type { Load } from "./use-dashboard-data";

// The top 5 of the month (FE-24, KAN-84), on its own: the screen's tests draw it with the canvas' data
// inside the whole dashboard; here are its states and its edges.

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const UYU = { code: "UYU", exponent: 2 };
const NBSP = " ";
const ID = (n: number) => "00000000-0000-4000-8000-00000000010" + n;

function category(n: number, name: string, amount: number, percentage: number) {
  return {
    category_id: ID(n),
    name,
    icon: "tag" as const,
    amount_minor: amount,
    percentage,
  };
}

function dashboard(overrides: Partial<DashboardRead> = {}): DashboardRead {
  return {
    month: "2026-10",
    available_minor: 0,
    card_debt_minor: 0,
    net_minor: 0,
    month_expense_minor: 3677000,
    top_expense_categories: [
      category(1, "Comida", 2123000, 58),
      category(2, "Transporte", 612000, 17),
    ],
    ...overrides,
  };
}

function load(overrides: Partial<Load<DashboardRead>> = {}): Load<DashboardRead> {
  return {
    data: dashboard(),
    error: undefined,
    failed: false,
    busy: false,
    retry: vi.fn(),
    ...overrides,
  };
}

function card(dashboardLoad: Load<DashboardRead>, currentMonth = "2026-10") {
  render(<TopExpensesCard dashboard={dashboardLoad} currency={UYU} currentMonth={currentMonth} />);
  return screen.getByRole("region", { name: /Gastos por categoría/ });
}

describe("TopExpensesCard", () => {
  it("has the two titles and the two links of the canvas, one for each width", () => {
    const region = card(load());
    const spans = Array.from(region.querySelectorAll<HTMLElement>("h2 > span"));
    expect(spans.map((span) => span.textContent)).toEqual([
      "Gastos de octubre",
      "Gastos por categoría",
    ]);
    expect(spans.map((span) => span.className)).toEqual(["lg:hidden", "max-lg:hidden"]);
    const link = within(region).getByRole("link", { name: /^Ver todo/ });
    expect(Array.from(link.querySelectorAll("span")).map((span) => span.textContent)).toEqual([
      "Ver todo",
      "Ver todas",
    ]);
    expect(link.getAttribute("href")).toBe("/movimientos?tipo=gastos");
  });

  it("gives the title the sizes of the canvas: 16 px, 18 px from 768 px and 19 px from 1024 px", () => {
    const heading = within(card(load())).getByRole("heading", { level: 2 });
    for (const expected of ["text-base", "md:text-lg", "lg:text-card-title"]) {
      expect(heading.className).toContain(expected);
    }
  });

  it("says the month of the dashboard in the title, not the screen's, when they differ", () => {
    const region = card(load({ data: dashboard({ month: "2026-09" }) }), "2026-10");
    expect(region.querySelector("h2 > span")?.textContent).toBe("Gastos de setiembre");
  });

  it("writes a share of 0 % as it comes, and gives a category with something at least a sliver of bar", () => {
    const region = card(
      load({
        data: dashboard({
          top_expense_categories: [category(1, "Comida", 100000000, 100), category(2, "Té", 1, 0)],
        }),
      }),
    );
    const [food, tea] = within(region).getAllByRole("listitem");
    expect(tea?.textContent).toContain("0" + NBSP + "%");
    const bar = tea?.querySelector<HTMLElement>("[aria-hidden='true'] > span");
    expect(bar?.style.width).toBe("2%");
    expect(food?.querySelector<HTMLElement>("[aria-hidden='true'] > span")?.style.width).toBe(
      "100%",
    );
  });

  it("keeps the order the backend gave, largest first", () => {
    const region = card(load());
    const names = within(region)
      .getAllByRole("listitem")
      .map((row) => within(row).getByTitle(/./).textContent);
    expect(names).toEqual(["Comida", "Transporte"]);
  });

  it("makes the whole row the link, and the bar is not read", () => {
    const region = card(load());
    const row = within(region).getAllByRole("listitem")[0] as HTMLElement;
    const link = within(row).getByRole("link");
    expect(link.getAttribute("href")).toBe("/movimientos?tipo=gastos&categoria_id=" + ID(1));
    expect(link.querySelector("[aria-hidden='true']")).not.toBeNull();
    // The accessible name is the visible text: name, share and amount.
    expect(link.textContent).toContain("Comida");
    expect(link.textContent).toContain("58" + NBSP + "%");
    expect(link.textContent).toContain("$" + NBSP + "21.230,00");
  });

  it("holds a name that cannot break and an amount past the limit without pushing the row out", () => {
    const long = "SupercalifragilísticoespialidosoSupercalifragilísticoespialidoso";
    const region = card(
      load({
        data: dashboard({
          top_expense_categories: [category(1, long, Number.MAX_SAFE_INTEGER, 100)],
        }),
      }),
    );
    const name = within(region).getByText(long);
    expect(name.className).toContain("truncate");
    expect(name.className).toContain("min-w-0");
    // The line may wrap: the amount drops under the name instead of squeezing it to nothing.
    expect((name.parentElement as HTMLElement).className).toContain("flex-wrap");
    expect(within(region).getByText("$ 90.071.992.547.409,91").className).toContain(
      "wrap-anywhere",
    );
  });

  it("holds the rows' place with a skeleton while the dashboard loads, titled with the screen's month", () => {
    const region = card(load({ data: undefined }), "2026-10");
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(region.querySelector("h2 > span")?.textContent).toBe("Gastos de octubre");
    expect(within(region).queryByRole("list")).toBeNull();
    expect(within(region).queryByRole("link")).toBeNull();
    expect(within(region).queryByText(/Aún no registras/)).toBeNull();
  });

  it("says it could not load them, with 'Reintentar', and never that there are no expenses", () => {
    const retry = vi.fn();
    const region = card(load({ data: undefined, failed: true, retry }));
    expect(within(region).getByText("No se pudieron cargar los gastos")).toBeTruthy();
    expect(within(region).queryByText(/Aún no registras/)).toBeNull();
    expect(within(region).queryByRole("link", { name: /^Ver todo/ })).toBeNull();
    fireEvent.click(within(region).getByRole("button", { name: "Reintentar" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("with no expenses says so and offers to register one, without 'Ver todo' or a list", () => {
    const region = card(
      load({ data: dashboard({ month_expense_minor: 0, top_expense_categories: [] }) }),
    );
    expect(within(region).getByText("Aún no registras gastos en octubre.")).toBeTruthy();
    const register = within(region).getByRole("link", { name: "Registrar un gasto" });
    expect(register.getAttribute("href")).toBe("/?movimiento=nuevo");
    expect(within(region).queryByRole("list")).toBeNull();
    expect(within(region).queryByRole("link", { name: /^Ver todo/ })).toBeNull();
    expect(region.getAttribute("aria-busy")).toBeNull();
  });

  it("names the list with the month, so a screen reader hears what it is", () => {
    const region = card(load());
    expect(
      within(region).getByRole("list", { name: "Gastos por categoría de octubre" }),
    ).toBeTruthy();
  });

  it("is a link row that tints on press and has a visible focus, with no animation for those who ask for none", () => {
    const row = within(card(load())).getAllByRole("link")[1] as HTMLElement;
    for (const expected of [
      "active:bg-primary-soft",
      "hover:bg-primary-soft",
      "motion-reduce:transition-none",
    ]) {
      expect(row.className).toContain(expected);
    }
    expect(row.className).toContain("min-h-11");
    expect(row.className).toContain("outline-ring");
  });
});

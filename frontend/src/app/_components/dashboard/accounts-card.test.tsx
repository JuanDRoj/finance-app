import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import { AccountsCard } from "./accounts-card";
import type { Load } from "./use-dashboard-data";

// "Cuentas", the compact list of the Inicio (FE-24, KAN-84). It takes over what the tests of "Tus cuentas"
// (FE-16) said about each row: the name cut with an ellipsis, the amount in the space's currency, a card
// by what it owes in the debt color, the typographic minus, the limit of the backend and the link of the
// row; and it adds what the canvas changed: no second line, "Ver cuentas" always, at most eight rows.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const UYU = { code: "UYU", exponent: 2 };
const NBSP = " ";
const MINUS = "−";

function account(overrides: Partial<AccountWithBalance> = {}): AccountWithBalance {
  return {
    id: "a1",
    name: "Itaú",
    type: "bank",
    closing_day: null,
    due_day: null,
    archived_at: null,
    balance_minor: 155050,
    ...overrides,
  };
}
const BANK = account();
const CASH = account({ id: "a2", name: "Billetera", type: "cash", balance_minor: 550000 });
const CARD = account({
  id: "a3",
  name: "Visa Itaú",
  type: "credit_card",
  closing_day: 5,
  due_day: 12,
  balance_minor: -2412000,
});

function load(overrides: Partial<Load<AccountWithBalance[]>> = {}): Load<AccountWithBalance[]> {
  return {
    data: [BANK, CASH, CARD],
    error: undefined,
    failed: false,
    busy: false,
    retry: vi.fn(),
    ...overrides,
  };
}

function card(accounts: Load<AccountWithBalance[]>, currency = UYU) {
  render(<AccountsCard accounts={accounts} currency={currency} />);
  return screen.getByRole("region", { name: "Cuentas" });
}

describe("AccountsCard", () => {
  it("lists the accounts in the order the API gave them, one row each", () => {
    const region = card(load());
    const rows = within(region).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(
      rows.map((row) => within(row).getByText(/^(Itaú|Billetera|Visa Itaú)$/).textContent),
    ).toEqual(["Itaú", "Billetera", "Visa Itaú"]);
  });

  it("is a desktop card, titled 'Cuentas' with 'Ver cuentas' that always leads to the list", () => {
    const region = card(load({ data: [BANK] }));
    expect(region.className).toContain("max-lg:hidden");
    expect(within(region).getByRole("heading", { level: 2, name: "Cuentas" })).toBeTruthy();
    expect(within(region).getByRole("link", { name: "Ver cuentas" }).getAttribute("href")).toBe(
      "/cuentas",
    );
  });

  it("has no line under the name: no type and no days, as the canvas draws it", () => {
    const rows = within(card(load())).getAllByRole("listitem");
    expect(rows[0]?.textContent).not.toContain("Banco");
    expect(rows[1]?.textContent).not.toContain("Efectivo");
    expect(rows[2]?.textContent).not.toContain("Cierra el 5");
    expect(rows[2]?.textContent).not.toContain("Tarjeta");
  });

  it("writes each balance in the space's currency, and a card by what it owes in the debt color", () => {
    const [bank, cash, visa] = within(card(load())).getAllByRole("listitem");
    expect(bank?.textContent).toContain("$" + NBSP + "1.550,50");
    expect(cash?.textContent).toContain("$" + NBSP + "5.500,00");
    // `balance_minor` is -2412000 (it owes): shown positive.
    expect(visa?.textContent).toContain("$" + NBSP + "24.120,00");
    expect(visa?.textContent).not.toContain(MINUS);
    expect(within(visa as HTMLElement).getByText(/24\.120,00/).className).toContain("text-debt");
    expect(within(bank as HTMLElement).getByText(/1\.550,50/).className).not.toContain("text-debt");
  });

  it("writes a negative balance with the typographic minus, and a card paid in excess too", () => {
    const [bank, visa] = within(
      card(
        load({
          data: [account({ balance_minor: -25075 }), account({ ...CARD, balance_minor: 10000 })],
        }),
      ),
    ).getAllByRole("listitem");
    expect(bank?.textContent).toContain(MINUS + "$" + NBSP + "250,75");
    expect(visa?.textContent).toContain(MINUS + "$" + NBSP + "100,00");
  });

  it("never writes '-0' for a card with nothing owed", () => {
    const [visa] = within(
      card(load({ data: [account({ ...CARD, balance_minor: 0 })] })),
    ).getAllByRole("listitem");
    expect(visa?.textContent).toContain("$" + NBSP + "0,00");
    expect(visa?.textContent).not.toContain(MINUS);
  });

  it("uses the currency of the space: dollars say 'US$'", () => {
    const region = card(load({ data: [BANK] }), { code: "USD", exponent: 2 });
    expect(region.textContent).toContain("US$" + NBSP + "1.550,50");
  });

  it("makes each row a link to the account's page (from 1024 px, to the list with it selected)", () => {
    const region = within(card(load()));
    const hrefs = region
      .getAllByRole("listitem")
      .map((row) => within(row).getByRole("link").getAttribute("href"));
    expect(hrefs).toEqual([BANK, CASH, CARD].map((item) => "/cuentas/" + item.id));
  });

  it("cuts a very long name with an ellipsis and keeps it whole in the title", () => {
    const long = "Cuenta ".repeat(40).trim();
    const region = card(load({ data: [account({ name: long })] }));
    const name = within(region).getByText(long);
    expect(name.className).toContain("truncate");
    expect(name.getAttribute("title")).toBe(long);
  });

  it("holds a balance at the limit of the backend, and lets it wrap instead of pushing the name out", () => {
    const region = card(load({ data: [account({ balance_minor: Number.MAX_SAFE_INTEGER })] }));
    const amount = within(region).getByText(/90\.071\.992\.547\.409,91/);
    expect(amount.className).toContain("wrap-anywhere");
  });

  it("lists at most eight rows, even with forty accounts", () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      account({ id: "a" + index, name: "Cuenta " + index }),
    );
    const rows = within(card(load({ data: many }))).getAllByRole("listitem");
    expect(rows).toHaveLength(8);
    expect(within(rows[7] as HTMLElement).getByText("Cuenta 7")).toBeTruthy();
  });

  it("never lists an archived account", () => {
    const region = card(
      load({
        data: [BANK, account({ id: "old", name: "Vieja", archived_at: "2026-09-01T10:00:00Z" })],
      }),
    );
    expect(within(region).queryByText("Vieja")).toBeNull();
  });

  it("holds the place of the rows with a skeleton while the accounts load", () => {
    const region = card(load({ data: undefined }));
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(within(region).queryByRole("listitem")).toBeNull();
    expect(within(region).queryByRole("alert")).toBeNull();
  });

  it("says it could not load them, with 'Reintentar', and never shows an empty list", () => {
    const retry = vi.fn();
    const region = card(load({ data: undefined, failed: true, retry }));
    expect(within(region).getByText("No se pudieron cargar tus cuentas")).toBeTruthy();
    expect(within(region).queryByRole("list")).toBeNull();
    within(region).getByRole("button", { name: "Reintentar" }).click();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

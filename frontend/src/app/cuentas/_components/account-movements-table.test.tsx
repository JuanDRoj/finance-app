import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ITAU,
  VISA,
  adjustmentItem,
  incomeItem,
  movementItem,
  transferItem,
} from "@/components/movements/movement-fixtures";
import { AccountMovementsTable } from "./account-movements-table";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const UYU = { code: "UYU", exponent: 2 };
const BANK = { id: ITAU.id, type: "bank" } as const;
const CARD = { id: VISA.id, type: "credit_card" } as const;

const ITEMS = [
  movementItem({
    id: "r1",
    date: "2026-10-19",
    description: "Uber",
    amount_minor: -38000,
    account: ITAU,
    balance_after_minor: 8425000,
  }),
  transferItem({ id: "r2", date: "2026-10-17", balance_after_minor: 8463000 }),
  incomeItem({ id: "r3", date: "2026-10-01", balance_after_minor: 10690000 }),
  movementItem({
    id: "r4",
    status: "pending",
    date: "2026-10-20",
    description: "Gimnasio",
    account: ITAU,
    balance_after_minor: null,
  }),
  adjustmentItem({ id: "r5", date: "2026-09-30", account: ITAU, balance_after_minor: 1 }),
];

function renderTable(account: { id: string; type: "bank" | "cash" | "credit_card" } = BANK) {
  return render(
    <AccountMovementsTable
      items={ITEMS}
      account={account}
      currency={UYU}
      today="2026-10-29"
      caption="Movimientos de Itaú en Octubre 2026"
    />,
  );
}

describe("AccountMovementsTable", () => {
  it("is a table named by its caption, with the columns of the canvas and Fecha as the order", () => {
    renderTable();
    const table = screen.getByRole("table", { name: "Movimientos de Itaú en Octubre 2026" });
    const heads = within(table).getAllByRole("columnheader");
    expect(heads.map((head) => head.textContent)).toEqual([
      "Fecha",
      "Descripción",
      "Categoría",
      "Monto",
      "Saldo",
    ]);
    expect(heads[0]!.getAttribute("aria-sort")).toBe("descending");
    // The description is the header of its row.
    expect(within(table).getAllByRole("rowheader")).toHaveLength(ITEMS.length);
  });

  it("says Deuda in the last column for a card", () => {
    renderTable(CARD);
    expect(screen.getByRole("columnheader", { name: "Deuda" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Saldo" })).toBeNull();
  });

  it("has only the links of the descriptions: no column of actions, no buttons", () => {
    renderTable();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      ITEMS.map((item) => `/movimientos?movimiento=editar&id=${item.id}`),
    );
    for (const link of links) expect(link.getAttribute("aria-haspopup")).toBe("dialog");
    // Nothing was made focusable by hand besides the links.
    expect(document.querySelectorAll("[tabindex]:not(a):not(button)")).toHaveLength(0);
  });

  it("writes the chip of each row: a category, Transferencia and Ajuste, the last two quiet", () => {
    renderTable();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    const chip = (row: HTMLElement) => row.children[2]!.firstElementChild as HTMLElement;
    expect(chip(rows[0]!).textContent).toBe("Comida › Supermercado");
    expect(chip(rows[0]!).className).toContain("bg-primary-soft");
    expect(chip(rows[1]!).textContent).toBe("Transferencia");
    expect(chip(rows[1]!).className).toContain("text-muted-foreground");
    expect(chip(rows[4]!).textContent).toBe("Ajuste");
  });

  it("tells a pending movement apart: its state under the description and a dash for the balance", () => {
    renderTable();
    const row = within(screen.getByRole("table")).getAllByRole("row")[4]!;
    expect(within(row).getByText("Pendiente")).toBeTruthy();
    expect(row.lastElementChild!.textContent).toContain("—");
    expect(row.lastElementChild!.textContent).toContain("No cuenta para el saldo");
  });

  it("writes the year of a date that is not this year's", () => {
    render(
      <AccountMovementsTable
        items={[movementItem({ id: "old", date: "2025-12-31", account: ITAU })]}
        account={BANK}
        currency={UYU}
        today="2026-10-29"
        caption="x"
      />,
    );
    expect(screen.getByText("31 dic. 2025")).toBeTruthy();
  });

  it("is a scroller with a floor of 560 px and tabular, never wrapping figures", () => {
    const { container } = renderTable();
    expect(container.firstElementChild!.className).toContain("overflow-x-auto");
    expect(screen.getByRole("table").className).toContain("min-w-140");
    const last = within(screen.getByRole("table")).getAllByRole("row")[1]!;
    for (const cell of [last.children[3]!, last.children[4]!]) {
      expect(cell.className).toContain("tabular-nums");
      expect(cell.className).toContain("whitespace-nowrap");
    }
  });
});

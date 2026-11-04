import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MovementsTable } from "./movements-table";
import {
  COMIDA,
  adjustmentItem,
  incomeItem,
  movementItem,
  transferItem,
} from "./movement-fixtures";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const UYU = { code: "UYU", exponent: 2 } as const;

function bodyRows() {
  return within(screen.getAllByRole("rowgroup")[1]!).getAllByRole("row");
}

describe("MovementsTable", () => {
  it("is a real table with a caption and the columns of the canvas, the last one only for assistive technology", () => {
    render(<MovementsTable items={[movementItem()]} currency={UYU} />);
    const table = screen.getByRole("table", { name: "Movimientos" });
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent)).toEqual([
      "Fecha",
      "Descripción",
      "Categoría",
      "Cuenta",
      "Monto",
      "Acciones",
    ]);
    // Nothing to see in that header: the buttons say what they are.
    expect(headers.at(-1)!.querySelector(".sr-only")?.textContent).toBe("Acciones");
  });

  it("takes the name a screen gives it", () => {
    render(<MovementsTable items={[]} currency={UYU} caption="Movimientos de Octubre 2026" />);
    expect(screen.getByRole("table", { name: "Movimientos de Octubre 2026" })).toBeTruthy();
  });

  it("says it is sorted by date, newest first, and says nothing of the other columns", () => {
    render(<MovementsTable items={[movementItem()]} currency={UYU} />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers[0]!.getAttribute("aria-sort")).toBe("descending");
    for (const header of headers.slice(1)) expect(header.getAttribute("aria-sort")).toBeNull();
  });

  it("has no sort buttons: the backend only sorts by date, so no header does anything", () => {
    const { container } = render(<MovementsTable items={[movementItem()]} currency={UYU} />);
    expect(container.querySelector("thead button, thead a, thead [tabindex]")).toBeNull();
  });

  describe("what a row can do (FE-23, KAN-83)", () => {
    const ID = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0020";
    const href = (id: string) => `/movimientos?movimiento=editar&id=${id}`;

    /** The controls of a row, by kind and name, in the order of the page. */
    function controls(row: HTMLElement) {
      return Array.from(row.querySelectorAll("a, button, input, select, textarea, [tabindex]")).map(
        (element) => ({
          tag: element.tagName.toLowerCase(),
          name: element.getAttribute("aria-label") ?? element.textContent,
          href: element.getAttribute("href"),
        }),
      );
    }

    it("a movement that can be edited has its description as a link, 'Editar X' and 'Eliminar X'", () => {
      render(
        <MovementsTable
          items={[movementItem({ id: ID, description: "Uber" })]}
          currency={UYU}
          onRemove={() => {}}
        />,
      );
      expect(controls(bodyRows()[0]!)).toEqual([
        { tag: "a", name: "Uber", href: href(ID) },
        { tag: "a", name: "Editar Uber", href: href(ID) },
        { tag: "button", name: "Eliminar Uber", href: null },
      ]);
    });

    it("an adjustment, a pending and a skipped movement have 'Ver X' and no delete: the API refuses it", () => {
      render(
        <MovementsTable
          items={[
            adjustmentItem({ id: "a-1", description: "Ajuste de saldo" }),
            movementItem({ id: "p-1", status: "pending", description: "Alquiler" }),
            movementItem({ id: "s-1", status: "skipped", description: "Gimnasio" }),
          ]}
          currency={UYU}
          onRemove={() => {}}
        />,
      );
      const names = bodyRows().map((row) => controls(row).map((control) => control.name));
      expect(names[0]).toEqual(["Ajuste de saldo", "Ver Ajuste de saldo"]);
      expect(names[1]).toEqual(["Alquiler", "Ver Alquiler"]);
      expect(names[2]).toEqual(["Gimnasio", "Ver Gimnasio"]);
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("without onRemove there is no delete at all, for any row (a table that only shows)", () => {
      render(
        <MovementsTable
          items={[movementItem(), incomeItem(), transferItem(), adjustmentItem()]}
          currency={UYU}
        />,
      );
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.getAllByRole("link")).toHaveLength(8);
    });

    it("has no tab stop made by hand, and the header still has no controls", () => {
      const { container } = render(
        <MovementsTable
          items={[movementItem(), incomeItem(), transferItem(), adjustmentItem()]}
          currency={UYU}
          onRemove={() => {}}
        />,
      );
      // The only tab stops are the links and the buttons themselves (Base UI gives its buttons a
      // `tabindex`): no cell, row or span was made focusable by hand.
      expect(container.querySelector("[tabindex]:not(a):not(button)")).toBeNull();
      expect(container.querySelector("thead a, thead button, thead [tabindex]")).toBeNull();
    });

    it("names the buttons by the movement, cut like a toast when it is long", () => {
      render(
        <MovementsTable
          items={[movementItem({ description: "a".repeat(200) })]}
          currency={UYU}
          onRemove={() => {}}
        />,
      );
      expect(screen.getByRole("link", { name: `Editar ${"a".repeat(39)}…` })).toBeTruthy();
      expect(screen.getByRole("button", { name: `Eliminar ${"a".repeat(39)}…` })).toBeTruthy();
    });

    it("asks to delete that movement and nothing else", () => {
      const onRemove = vi.fn();
      const uber = movementItem({ id: "m-uber", description: "Uber" });
      const cafe = movementItem({ id: "m-cafe", description: "Café" });
      render(<MovementsTable items={[uber, cafe]} currency={UYU} onRemove={onRemove} />);
      fireEvent.click(screen.getByRole("button", { name: "Eliminar Café" }));
      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(onRemove).toHaveBeenCalledWith(cafe);
    });

    it("shows the delete of the movements being deleted busy, and only those", () => {
      render(
        <MovementsTable
          items={[
            movementItem({ id: "m-uber", description: "Uber" }),
            movementItem({ id: "m-cafe", description: "Café" }),
            movementItem({ id: "m-pan", description: "Pan" }),
          ]}
          currency={UYU}
          onRemove={() => {}}
          pendingIds={new Set(["m-cafe", "m-pan"])}
        />,
      );
      for (const name of ["Eliminar Café", "Eliminar Pan"]) {
        const busy = screen.getByRole("button", { name });
        expect(busy.getAttribute("aria-busy")).toBe("true");
        expect(busy.querySelector("svg")?.getAttribute("class")).toContain("animate-spin");
      }
      expect(
        screen.getByRole("button", { name: "Eliminar Uber" }).getAttribute("aria-busy"),
      ).toBeNull();
    });

    it("keeps the actions at 36 px with a mouse and 44 with a finger, at full strength", () => {
      render(<MovementsTable items={[movementItem()]} currency={UYU} onRemove={() => {}} />);
      for (const control of [
        screen.getByRole("link", { name: /^Editar/ }),
        screen.getByRole("button", { name: /^Eliminar/ }),
      ]) {
        expect(control.className).toContain("size-9");
        expect(control.className).toContain("pointer-coarse:size-11");
        expect(control.className).toContain("text-muted-foreground");
        expect(control.className).not.toContain("opacity");
      }
    });

    it("pins 'Acciones' to the right edge on a solid background, so it stays in reach when the card scrolls", () => {
      render(<MovementsTable items={[movementItem()]} currency={UYU} onRemove={() => {}} />);
      const head = screen.getAllByRole("columnheader").at(-1)!;
      const cell = within(bodyRows()[0]!).getAllByRole("cell").at(-1)!;
      for (const element of [head, cell]) {
        expect(element.className).toContain("sticky");
        expect(element.className).toContain("right-0");
        expect(element.className).toContain("bg-surface");
        expect(element.className).toContain("w-21");
      }
      // The tint of the hovered row is drawn over that solid cell, so the row reads as one.
      expect(cell.className).toContain("group-hover:after:opacity-100");
      expect(bodyRows()[0]!.className).toContain("group");
    });

    it("tints a row under the mouse with the sel of the canvas", () => {
      render(<MovementsTable items={[movementItem()]} currency={UYU} />);
      const row = bodyRows()[0]!;
      expect(row.className).toContain("hover:bg-primary/10");
      expect(row.className).toContain("dark:hover:bg-primary/12");
    });
  });

  it("writes a row: the date, the description as the row header, the category chip, the account and the amount", () => {
    render(<MovementsTable items={[movementItem()]} currency={UYU} />);
    const [row] = bodyRows();
    const cells = within(row!).getAllByRole("cell");
    expect(within(row!).getByRole("rowheader").textContent).toBe("Tienda Inglesa");
    // The last cell is "Acciones": its buttons have no text, they have names.
    expect(cells.map((cell) => cell.textContent)).toEqual([
      "20 oct.",
      "Comida › Supermercado",
      "Visa Itaú",
      "−$ 2.340,00",
      "",
    ]);
  });

  it("writes the principal alone, and the category as the description's stand-in", () => {
    render(
      <MovementsTable
        items={[movementItem({ description: null, category: COMIDA })]}
        currency={UYU}
      />,
    );
    const [row] = bodyRows();
    expect(within(row!).getByRole("rowheader").textContent).toBe("Comida");
    expect(within(row!).getAllByRole("cell")[1]!.textContent).toBe("Comida");
  });

  it("paints each amount by type: the minus in the text color, the plus in income, the rest quiet", () => {
    render(
      <MovementsTable
        items={[movementItem(), incomeItem(), transferItem(), adjustmentItem()]}
        currency={UYU}
      />,
    );
    const amounts = bodyRows().map((row) => {
      const cell = within(row).getAllByRole("cell").at(-2)!;
      return { text: cell.textContent, className: cell.className };
    });
    expect(amounts[0]!.text).toBe("−$ 2.340,00");
    expect(amounts[0]!.className).toContain("text-foreground");
    expect(amounts[1]!.text).toBe("+$ 68.000,00");
    expect(amounts[1]!.className).toContain("text-income");
    expect(amounts[2]!.text).toBe("$ 18.500,00");
    expect(amounts[2]!.className).toContain("text-muted-foreground");
    expect(amounts[3]!.text).toBe("−$ 300,00");
    expect(amounts[3]!.className).toContain("text-muted-foreground");
    for (const amount of amounts) {
      expect(amount.className).toContain("text-right");
      expect(amount.className).toContain("tabular-nums");
      expect(amount.className).toContain("whitespace-nowrap");
    }
  });

  it("tells a transfer by its two accounts and an adjustment by its type, in quiet chips", () => {
    render(<MovementsTable items={[transferItem(), adjustmentItem()]} currency={UYU} />);
    const [transfer, adjustment] = bodyRows();
    const transferCells = within(transfer!).getAllByRole("cell");
    expect(transferCells[1]!.textContent).toBe("Transferencia");
    expect(transferCells[2]!.textContent).toBe("Itaú → Visa Itaú");
    const chip = transferCells[1]!.firstElementChild!;
    expect(chip.className).toContain("bg-foreground/6");
    expect(chip.className).not.toContain("bg-primary-soft");
    expect(within(adjustment!).getAllByRole("cell")[1]!.textContent).toBe("Ajuste");
  });

  it("puts a category on the green chip", () => {
    render(<MovementsTable items={[movementItem()]} currency={UYU} />);
    const chip = within(bodyRows()[0]!).getAllByRole("cell")[1]!.firstElementChild!;
    expect(chip.className).toContain("bg-primary-soft");
    expect(chip.className).toContain("rounded-full");
  });

  it("writes the year of a date that is not of the current one", () => {
    render(
      <MovementsTable
        items={[movementItem({ date: "2025-12-31" }), movementItem({ date: "2026-10-20" })]}
        currency={UYU}
        today="2026-10-22"
      />,
    );
    const dates = bodyRows().map((row) => within(row).getAllByRole("cell")[0]!.textContent);
    expect(dates).toEqual(["31 dic. 2025", "20 oct."]);
  });

  it("shows the state of a movement that is not confirmed under its description", () => {
    render(
      <MovementsTable
        items={[movementItem({ status: "pending" }), movementItem({ status: "confirmed" })]}
        currency={UYU}
      />,
    );
    const [pending, confirmed] = bodyRows();
    expect(within(pending!).getByRole("rowheader").textContent).toContain("Pendiente");
    expect(within(confirmed!).getByRole("rowheader").textContent).not.toContain("Pendiente");
  });

  it("wraps a long description in two lines and cuts what has no room, with the whole text in title", () => {
    const description = "z".repeat(200);
    const category = "Mucho texto ".repeat(8).trim();
    render(
      <MovementsTable
        items={[
          movementItem({
            description,
            category: { id: "c", name: category, icon: "tag", parent: null },
            account: { id: "a", name: "Cuenta muy larga ".repeat(5).trim(), type: "bank" },
          }),
        ]}
        currency={UYU}
      />,
    );
    const row = bodyRows()[0]!;
    const title = within(row).getByText(description);
    expect(title.className).toContain("line-clamp-2");
    expect(title.className).toContain("wrap-anywhere");
    expect(title.getAttribute("title")).toBe(description);
    const chip = within(row).getByText(category);
    expect(chip.className).toContain("truncate");
    expect(chip.getAttribute("title")).toBe(category);
    const account = within(row).getByText(/^Cuenta muy larga/);
    expect(account.className).toContain("truncate");
    expect(account.getAttribute("title")).toBe(account.textContent);
  });

  it("never cuts an amount, not even the largest the backend takes", () => {
    render(
      <MovementsTable
        items={[incomeItem({ amount_minor: Number.MAX_SAFE_INTEGER })]}
        currency={UYU}
      />,
    );
    const amount = within(bodyRows()[0]!).getAllByRole("cell").at(-2)!;
    expect(amount.textContent).toBe("+$ 90.071.992.547.409,91");
    expect(amount.className).not.toContain("truncate");
    expect(amount.className).toContain("whitespace-nowrap");
  });

  it("sits in a scroller with a floor of 760 px, and takes the class the screen gives it", () => {
    const { container } = render(
      <MovementsTable items={[]} currency={UYU} className="max-lg:hidden" />,
    );
    const scroller = container.firstElementChild!;
    expect(scroller.className).toContain("overflow-x-auto");
    expect(scroller.className).toContain("max-lg:hidden");
    expect(scroller.querySelector("table")!.className).toContain("min-w-190");
  });

  it("draws just the head for no rows", () => {
    render(<MovementsTable items={[]} currency={UYU} />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);
    expect(screen.queryAllByRole("rowheader")).toHaveLength(0);
  });
});

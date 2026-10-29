import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MovementRow } from "./movement-row";
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

function renderRow(item = movementItem()) {
  render(
    <ul>
      <MovementRow item={item} currency={UYU} />
    </ul>,
  );
  return screen.getByRole("listitem");
}

describe("MovementRow", () => {
  it("shows the description, the category and the account, and the amount with its minus", () => {
    const row = renderRow();
    expect(within(row).getByText("Tienda Inglesa")).toBeTruthy();
    expect(within(row).getByText("Supermercado · Visa Itaú")).toBeTruthy();
    const amount = within(row).getByText(/2\.340,00/);
    expect(amount.textContent).toBe("−$ 2.340,00");
    expect(amount.className).toContain("text-foreground");
    expect(amount.className).toContain("tabular-nums");
  });

  it("paints an income with the plus in the income color", () => {
    const row = renderRow(incomeItem());
    const amount = within(row).getByText(/68\.000,00/);
    expect(amount.textContent).toBe("+$ 68.000,00");
    expect(amount.className).toContain("text-income");
  });

  it("paints a transfer with no sign, quiet, with its two accounts and a neutral tile", () => {
    const row = renderRow(transferItem());
    expect(within(row).getByText("Transferencia · Itaú → Visa Itaú")).toBeTruthy();
    const amount = within(row).getByText(/18\.500,00/);
    expect(amount.textContent).toBe("$ 18.500,00");
    expect(amount.className).toContain("text-muted-foreground");
    const tile = row.querySelector("[data-slot='movement-icon']")!;
    expect(tile.className).toContain("bg-foreground/6");
    expect(tile.className).not.toContain("bg-secondary");
  });

  it("paints an adjustment with its own sign, quiet, and says 'Ajuste · cuenta'", () => {
    const row = renderRow(adjustmentItem());
    expect(within(row).getByText("Ajuste · Efectivo")).toBeTruthy();
    const amount = within(row).getByText(/300,00/);
    expect(amount.textContent).toBe("−$ 300,00");
    expect(amount.className).toContain("text-muted-foreground");
  });

  it("puts a category on the green tile, and the icon of its own", () => {
    const row = renderRow(movementItem({ description: null, category: COMIDA }));
    const tile = row.querySelector("[data-slot='movement-icon']")!;
    expect(tile.className).toContain("bg-secondary");
    expect(tile.querySelector("svg")).toBeTruthy();
    // With no description the category stands in as the title.
    expect(within(row).getByText("Comida", { selector: "span[title]" })).toBeTruthy();
  });

  it("is read only: no link, no button, nothing to tab to", () => {
    const row = renderRow();
    expect(row.querySelector("a, button, input, select, [tabindex], [role='button']")).toBeNull();
    expect(row.getAttribute("aria-hidden")).toBeNull();
  });

  it("hides the tile from assistive technology: the text says the same", () => {
    const row = renderRow();
    expect(row.querySelector("[data-slot='movement-icon']")!.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("is 64 px tall at least and does not let the text push the amount out", () => {
    const row = renderRow();
    expect(row.className).toContain("min-h-16");
    const [icon, text, amount] = Array.from(row.children);
    expect(icon!.className).toContain("shrink-0");
    expect(text!.className).toContain("min-w-0");
    expect(text!.className).toContain("flex-1");
    expect(amount!.className).toContain("shrink-0");
  });

  it("cuts a very long description and category with '…' and keeps the whole text in title", () => {
    const description = "Compra del mes en la feria de la plaza del barrio ".repeat(4).trim();
    const row = renderRow(movementItem({ description }));
    const title = within(row).getByText(description);
    expect(title.className).toContain("truncate");
    expect(title.getAttribute("title")).toBe(description);
  });

  it("lets an unbroken 200-character description be cut instead of widening the row", () => {
    const description = "x".repeat(200);
    const row = renderRow(movementItem({ description }));
    const title = within(row).getByText(description);
    expect(title.className).toContain("truncate");
    expect(title.parentElement!.className).toContain("min-w-0");
  });

  it("keeps the largest amount the backend takes whole, and lets it wrap before it is cut", () => {
    const row = renderRow(incomeItem({ amount_minor: Number.MAX_SAFE_INTEGER }));
    const amount = within(row).getByText(/90\.071\.992\.547\.409,91/);
    expect(amount.textContent).toBe("+$ 90.071.992.547.409,91");
    expect(amount.className).toContain("wrap-anywhere");
    expect(amount.className).toContain("max-w-3/5");
    expect(amount.className).not.toContain("truncate");
  });

  it("ends the line with the state of a movement that is not confirmed", () => {
    const row = renderRow(movementItem({ status: "pending" }));
    expect(within(row).getByText("Supermercado · Visa Itaú · Pendiente")).toBeTruthy();
  });

  it("never shows 'null' or 'undefined' for a movement with nothing to say", () => {
    const row = renderRow(
      movementItem({ description: null, category: null, account: null, status: "confirmed" }),
    );
    expect(row.textContent).not.toMatch(/null|undefined/);
    expect(within(row).getAllByText("Gasto").length).toBeGreaterThan(0);
  });
});

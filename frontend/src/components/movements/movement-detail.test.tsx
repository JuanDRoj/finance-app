import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MovementRead } from "@/lib/core/data/transactions";
import { ADJUSTMENT_NOTE, MovementDetail, reconcileHref } from "./movement-detail";

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const UYU = { code: "UYU", exponent: 2 } as const;
const NBSP = "\u00A0";
const MINUS = "\u2212";

const EFECTIVO = {
  id: "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0004",
  name: "Efectivo",
  type: "cash",
} as const;
const ITAU = { id: "a1", name: "Itaú", type: "bank" } as const;
const VISA = { id: "a2", name: "Visa Itaú", type: "credit_card" } as const;

/** The canvas' adjustment: "− $ 300,00" in Efectivo on Tuesday the 13th of October. */
const AJUSTE: MovementRead = {
  id: "mov-ajuste",
  type: "adjustment",
  status: "confirmed",
  date: "2026-10-13",
  description: null,
  amount_minor: -30000,
  category: null,
  account: EFECTIVO,
  from_account: null,
  to_account: null,
};
const PENDIENTE: MovementRead = {
  id: "mov-pend",
  type: "expense",
  status: "pending",
  date: "2026-10-20",
  description: "Alquiler",
  amount_minor: -2_500_000,
  category: {
    id: "c2",
    name: "Alquiler",
    icon: "house",
    parent: { id: "c1", name: "Hogar", icon: "house" },
  },
  account: ITAU,
  from_account: null,
  to_account: null,
};
const PAGO: MovementRead = {
  id: "mov-pago",
  type: "transfer",
  status: "confirmed",
  date: "2026-10-20",
  description: "Pago de la tarjeta",
  amount_minor: 1_850_000,
  category: null,
  account: null,
  from_account: ITAU,
  to_account: VISA,
};

type Props = Partial<Parameters<typeof MovementDetail>[0]>;

function renderDetail(props: Props = {}) {
  const onClose = vi.fn();
  const view = render(
    <MovementDetail
      movement={AJUSTE}
      kind="adjustment"
      currency={UYU}
      today="2026-10-21"
      variant="sheet"
      onClose={onClose}
      {...props}
    />,
  );
  return { ...view, onClose };
}

/** The rows of the card as `[label, value]`. */
function rows(): [string, string][] {
  const list = document.querySelector("dl") as HTMLElement;
  return Array.from(list.querySelectorAll("dt")).map((dt) => [
    dt.textContent ?? "",
    dt.nextElementSibling?.textContent ?? "",
  ]);
}

describe("an adjustment ('Ajuste de saldo')", () => {
  it("shows the amount with its sign, the account and the date, as the canvas draws them", () => {
    renderDetail();
    expect(rows()).toEqual([
      ["Monto", `${MINUS}$${NBSP}300,00`],
      ["Cuenta", "Efectivo"],
      ["Fecha", "Martes 13 de octubre"],
    ]);
  });

  it("is a description list: each label names its value", () => {
    renderDetail();
    expect(document.querySelectorAll("dl")).toHaveLength(1);
    expect(document.querySelectorAll("dt")).toHaveLength(3);
    expect(document.querySelectorAll("dd")).toHaveLength(3);
  });

  it("an adjustment that raises the balance has a '+'", () => {
    renderDetail({ movement: { ...AJUSTE, amount_minor: 125050 } });
    expect(rows()[0]).toEqual(["Monto", `+$${NBSP}1.250,50`]);
  });

  it("says why it cannot be edited, with the approved text: to correct it, match the account again", () => {
    renderDetail();
    expect(ADJUSTMENT_NOTE).toBe(
      "Los ajustes salen de «Cuadrar saldo» y no cuentan como ingreso ni gasto. No se editan: si no corresponde, cuadra la cuenta de nuevo.",
    );
    expect(screen.getByText(ADJUSTMENT_NOTE)).toBeTruthy();
    // The canvas' old text promised a delete the API refuses.
    expect(document.body.textContent).not.toContain("elimínalo");
  });

  it("has NO 'Eliminar ajuste' and no delete at all: the API answers 409 transaction_not_editable", () => {
    renderDetail();
    expect(screen.queryByRole("button", { name: /Eliminar/ })).toBeNull();
    expect(screen.queryByText(/Eliminar/)).toBeNull();
  });

  it("links to 'Cuadrar saldo' of its account, which /cuentas opens as a panel or as a page", () => {
    renderDetail();
    const link = screen.getByRole("link", { name: "Cuadrar saldo" });
    expect(link.getAttribute("href")).toBe(`/cuentas?sel=${EFECTIVO.id}&cuenta=cuadrar`);
    expect(reconcileHref("a b")).toBe("/cuentas?sel=a%20b&cuenta=cuadrar");
  });

  it("leaves out that link when the account is archived: it cannot be matched", () => {
    renderDetail({ archivedAccounts: [{ id: EFECTIVO.id, name: "Efectivo" }] });
    expect(screen.queryByRole("link", { name: "Cuadrar saldo" })).toBeNull();
    // The note is still the same: the way out is to unarchive and match, which Cuentas explains.
    expect(screen.getByText(ADJUSTMENT_NOTE)).toBeTruthy();
  });

  it("leaves out the link of an adjustment with no account to match", () => {
    renderDetail({ movement: { ...AJUSTE, account: null } });
    expect(screen.queryByRole("link")).toBeNull();
    expect(rows()[1]).toEqual(["Cuenta", "Sin cuenta"]);
  });

  it("writes the year when the date is not of the current one", () => {
    renderDetail({ movement: { ...AJUSTE, date: "2025-10-13" } });
    expect(rows()[2]).toEqual(["Fecha", "Lunes 13 de octubre de 2025"]);
  });

  it("shows no description, state or type rows", () => {
    renderDetail({ movement: { ...AJUSTE, description: "Ajuste de saldo" } });
    expect(rows().map(([label]) => label)).toEqual(["Monto", "Cuenta", "Fecha"]);
  });
});

describe("'Cerrar'", () => {
  it("is the one button, and closes", () => {
    const { onClose } = renderDetail();
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Cerrar"]);
    fireEvent.click(buttons[0]!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("on a phone is full width and outlined; on desktop it is the primary button of the footer", () => {
    const phone = renderDetail({ variant: "sheet" });
    const sheetButton = screen.getByRole("button", { name: "Cerrar" });
    expect(sheetButton.className).toContain("flex-1");
    expect(sheetButton.className).toContain("border");
    phone.unmount();
    renderDetail({ variant: "panel" });
    const panelButton = screen.getByRole("button", { name: "Cerrar" });
    expect(panelButton.className).toContain("bg-primary");
    expect(panelButton.className).not.toContain("flex-1");
  });
});

describe("a pending or skipped movement", () => {
  it("shows what it is: type, category, account, date, description and state", () => {
    renderDetail({ movement: PENDIENTE, kind: "unconfirmed" });
    expect(rows()).toEqual([
      ["Monto", `${MINUS}$${NBSP}25.000,00`],
      ["Tipo", "Gasto"],
      ["Categoría", "Hogar › Alquiler"],
      ["Cuenta", "Itaú"],
      ["Fecha", "Martes 20 de octubre"],
      ["Descripción", "Alquiler"],
      ["Estado", "Pendiente"],
    ]);
  });

  it("says it cannot be edited or deleted from here, naming the state; no link to Cuadrar saldo", () => {
    renderDetail({ movement: PENDIENTE, kind: "unconfirmed" });
    expect(
      screen.getByText(
        "Este movimiento está pendiente. Los movimientos pendientes y omitidos no se pueden editar ni eliminar desde aquí.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button", { name: /Eliminar|Editar/ })).toBeNull();
  });

  it("a skipped one says 'omitido'", () => {
    renderDetail({ movement: { ...PENDIENTE, status: "skipped" }, kind: "unconfirmed" });
    expect(screen.getByText(/Este movimiento está omitido\./)).toBeTruthy();
    expect(rows().at(-1)).toEqual(["Estado", "Omitido"]);
  });

  it("a transfer shows 'Desde' and 'Hacia' instead of the category and the account", () => {
    renderDetail({
      movement: { ...PAGO, status: "pending" },
      kind: "unconfirmed",
    });
    expect(rows().map(([label]) => label)).toEqual([
      "Monto",
      "Tipo",
      "Desde",
      "Hacia",
      "Fecha",
      "Descripción",
      "Estado",
    ]);
    expect(rows()[1]).toEqual(["Tipo", "Transferencia"]);
    expect(rows()[2]).toEqual(["Desde", "Itaú"]);
    expect(rows()[3]).toEqual(["Hacia", "Visa Itaú"]);
    // A transfer has no sign.
    expect(rows()[0]).toEqual(["Monto", `$${NBSP}18.500,00`]);
  });

  it("leaves out the description row when it has none", () => {
    renderDetail({
      movement: { ...PENDIENTE, description: null },
      kind: "unconfirmed",
    });
    expect(rows().map(([label]) => label)).not.toContain("Descripción");
  });
});

describe("a movement of an archived account", () => {
  it("names the account to unarchive in the note, links to Cuentas and shows no state row", () => {
    renderDetail({
      movement: { ...PENDIENTE, status: "confirmed" },
      kind: "archived-account",
      archivedAccounts: [{ id: ITAU.id, name: "Itaú" }],
    });
    expect(
      screen.getByText("Desarchiva «Itaú» desde Cuentas para editar o eliminar este movimiento."),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ir a Cuentas" }).getAttribute("href")).toBe(
      "/cuentas",
    );
    expect(rows().map(([label]) => label)).not.toContain("Estado");
    expect(screen.queryByRole("link", { name: "Cuadrar saldo" })).toBeNull();
  });

  it("names both accounts of a transfer", () => {
    renderDetail({
      movement: PAGO,
      kind: "archived-account",
      archivedAccounts: [
        { id: ITAU.id, name: "Itaú" },
        { id: VISA.id, name: "Visa Itaú" },
      ],
    });
    expect(
      screen.getByText(
        "Desarchiva «Itaú» y «Visa Itaú» desde Cuentas para editar o eliminar este movimiento.",
      ),
    ).toBeTruthy();
  });

  it("does not say 'undefined' if the list of archived accounts was not given", () => {
    renderDetail({ movement: PENDIENTE, kind: "archived-account" });
    expect(
      screen.getByText(
        "Desarchiva la cuenta desde Cuentas para editar o eliminar este movimiento.",
      ),
    ).toBeTruthy();
  });
});

describe("the worst data", () => {
  it("breaks a long description and a long account name instead of overflowing, and never cuts the amount", () => {
    const long = "A".repeat(200);
    renderDetail({
      movement: {
        ...PENDIENTE,
        description: long,
        account: { ...ITAU, name: "B".repeat(120) },
        amount_minor: -Number.MAX_SAFE_INTEGER,
      },
      kind: "unconfirmed",
    });
    const description = screen.getByText(long);
    expect(description.className).toContain("wrap-anywhere");
    expect(description.className).not.toContain("truncate");
    expect(within(description.closest("div") as HTMLElement).getByText("Descripción")).toBeTruthy();
    expect(screen.getByText("B".repeat(120)).className).toContain("wrap-anywhere");
    expect(rows()[0]![1]).toBe(`${MINUS}$${NBSP}90.071.992.547.409,91`);
  });

  it("writes the amount with the exponent of the currency: 0 and 3 decimals", () => {
    const peso = renderDetail({
      movement: { ...AJUSTE, amount_minor: 1500 },
      currency: { code: "COP", exponent: 0 },
    });
    expect(rows()[0]![1]).toMatch(/1\.500$/);
    peso.unmount();
    renderDetail({
      movement: { ...AJUSTE, amount_minor: -1234 },
      currency: { code: "UYU", exponent: 3 },
    });
    expect(rows()[0]![1]).toMatch(/1,234$/);
  });

  it("a date that is not a real day is shown as it came, not as an error", () => {
    renderDetail({ movement: { ...AJUSTE, date: "2026-02-31" } });
    expect(rows()[2]).toEqual(["Fecha", "2026-02-31"]);
  });
});

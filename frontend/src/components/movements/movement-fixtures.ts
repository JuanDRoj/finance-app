import type { MovementListItem } from "@/lib/core/data/transactions";

// Movements for the tests and the catalog of Movimientos (FE-32): the shape `GET /transactions`
// answers, with the accounts and categories of the Kanza canvas. Not imported by the app.

export const ITAU = { id: "a1", name: "Itaú", type: "bank" } as const;
export const VISA = { id: "a2", name: "Visa Itaú", type: "credit_card" } as const;
export const EFECTIVO = { id: "a3", name: "Efectivo", type: "cash" } as const;

export const COMIDA = { id: "c1", name: "Comida", icon: "fork-knife", parent: null } as const;
export const SUPERMERCADO = {
  id: "c2",
  name: "Supermercado",
  icon: "shopping-cart",
  parent: { id: "c1", name: "Comida", icon: "fork-knife" },
} as const;

let counter = 0;

/** An expense with a subcategory on a card; any field can be overridden. */
export function movementItem(overrides: Partial<MovementListItem> = {}): MovementListItem {
  counter += 1;
  return {
    id: `m${counter}`,
    type: "expense",
    status: "confirmed",
    date: "2026-10-20",
    description: "Tienda Inglesa",
    amount_minor: -234000,
    category: SUPERMERCADO,
    account: VISA,
    from_account: null,
    to_account: null,
    balance_after_minor: null,
    ...overrides,
  };
}

export function incomeItem(overrides: Partial<MovementListItem> = {}): MovementListItem {
  return movementItem({
    type: "income",
    description: "Sueldo",
    amount_minor: 6800000,
    category: { id: "c9", name: "Sueldo", icon: "money", parent: null },
    account: ITAU,
    ...overrides,
  });
}

export function transferItem(overrides: Partial<MovementListItem> = {}): MovementListItem {
  return movementItem({
    type: "transfer",
    description: "Pago de Visa Itaú",
    amount_minor: 1850000,
    category: null,
    account: null,
    from_account: ITAU,
    to_account: VISA,
    ...overrides,
  });
}

export function adjustmentItem(overrides: Partial<MovementListItem> = {}): MovementListItem {
  return movementItem({
    type: "adjustment",
    description: "Ajuste de saldo",
    amount_minor: -30000,
    category: null,
    account: EFECTIVO,
    ...overrides,
  });
}

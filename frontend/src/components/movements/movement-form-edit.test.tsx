import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { CategoryRead } from "@/lib/core/data/categories";
import type { MovementRead } from "@/lib/core/data/transactions";
import { MovementForm, type MovementFormProps } from "./movement-form";

// "Editar movimiento" (FE-34, KAN-99): the same form as "Registrar movimiento", started on a saved
// movement. The create form has its own tests (`movement-form.test.tsx`); these are what editing
// changes: the values it starts on, the type that cannot change, the whole-movement `PUT` without an
// `Idempotency-Key`, nothing sent when nothing changed, the errors of a movement that is already
// there (404 and 409), the archived category it keeps, and "Eliminar".
const mocks = vi.hoisted(() => ({
  put: vi.fn(),
  post: vi.fn(),
  toastSuccess: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess } }));
vi.mock("@/components/nav-sections", () => ({ MORE_SECTIONS: [] }));

const api = { PUT: mocks.put, POST: mocks.post } as unknown as ApiClient;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
  window.localStorage.clear();
});

const SPACE = {
  id: "space-1",
  currency: { code: "UYU", exponent: 2 },
  timezone: "America/Montevideo",
};

function account(id: string, name: string, type: AccountWithBalance["type"] = "bank") {
  return {
    id,
    name,
    type,
    closing_day: null,
    due_day: null,
    archived_at: null,
    balance_minor: 0,
  } satisfies AccountWithBalance;
}
const ITAU = account("acc-itau", "Itaú");
const BROU = account("acc-brou", "BROU Caja de ahorro");
const EFECTIVO = account("acc-efectivo", "Efectivo", "cash");
const VISA = account("acc-visa", "Visa Itaú", "credit_card");
const ACCOUNTS = [ITAU, BROU, EFECTIVO, VISA];

function category(
  name: string,
  overrides: Partial<CategoryRead> = {},
  kind: CategoryRead["kind"] = "expense",
): CategoryRead {
  return {
    id: `cat-${name}`,
    kind,
    name,
    icon: "tag",
    parent_id: null,
    archived_at: null,
    ...overrides,
  };
}
const COMIDA = category("Comida", { icon: "fork-knife" });
const TRANSPORTE = category("Transporte", { icon: "car" });
const ROPA = category("Ropa", { icon: "t-shirt" });
const TRABAJO = category("Trabajo", { icon: "briefcase" }, "income");
const TAXI = category("Taxi y apps", { parent_id: TRANSPORTE.id, icon: "taxi" });
const CATEGORIES = [
  COMIDA,
  TRANSPORTE,
  ROPA,
  TRABAJO,
  category("Supermercado", { parent_id: COMIDA.id }),
  TAXI,
  category("Combustible", { parent_id: TRANSPORTE.id, icon: "gas-pump" }),
  category("Sueldo", { parent_id: TRABAJO.id }, "income"),
];

const ARCHIVED_AT = "2026-10-01T10:00:00Z";

/** An expense on a card, 380,00, the 19th (today is the 26th): the canvas' "Uber". */
const UBER: MovementRead = {
  id: "mov-uber",
  type: "expense",
  status: "confirmed",
  date: "2026-10-19",
  description: "Uber",
  amount_minor: -38000,
  category: { id: TAXI.id, name: "Taxi y apps", icon: "taxi", parent: null },
  account: { id: ITAU.id, name: "Itaú", type: "bank" },
  from_account: null,
  to_account: null,
};
const SUELDO: MovementRead = {
  ...UBER,
  id: "mov-sueldo",
  type: "income",
  description: null,
  amount_minor: 5_000_000,
  category: { id: "cat-Sueldo", name: "Sueldo", icon: "tag", parent: null },
};
const PAGO: MovementRead = {
  ...UBER,
  id: "mov-pago",
  type: "transfer",
  description: "Pago de la tarjeta",
  amount_minor: 1_850_000,
  category: null,
  account: null,
  from_account: { id: ITAU.id, name: "Itaú", type: "bank" },
  to_account: { id: VISA.id, name: "Visa Itaú", type: "credit_card" },
};

function ok(data: unknown) {
  return { data, response: new Response(null, { status: 200 }) };
}
function failure(status: number, body?: unknown) {
  return { error: body, response: new Response(null, { status }) };
}

beforeEach(() => {
  mocks.put.mockReset().mockResolvedValue(ok(UBER));
  mocks.post.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.replace.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T15:00:00Z"));
  vi.stubGlobal("location", { ...window.location, replace: mocks.replace });
});

type EditProps = Partial<Extract<MovementFormProps, { mode: "edit" }>>;

function Harness(props: EditProps) {
  const [picking, setPicking] = useState<string | null>(null);
  return (
    <MovementForm
      space={SPACE}
      accounts={ACCOUNTS}
      categories={CATEGORIES}
      variant="sheet"
      mode="edit"
      movement={UBER}
      onDone={() => {}}
      onUnchanged={() => {}}
      onDelete={() => {}}
      onNeedAccount={() => {}}
      api={api}
      {...props}
      picking={picking}
      onPickingChange={setPicking}
    />
  );
}

function renderEdit(props: EditProps = {}) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const onDone = vi.fn();
  const onUnchanged = vi.fn();
  const onDelete = vi.fn();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Harness onDone={onDone} onUnchanged={onUnchanged} onDelete={onDelete} {...props} />
    </QueryClientProvider>,
  );
  return { ...view, onDone, onUnchanged, onDelete, invalidate };
}

function type(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function save() {
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
}

function keysInvalidated(invalidate: { mock: { calls: unknown[][] } }) {
  return invalidate.mock.calls.map(([filters]) => (filters as { queryKey: unknown }).queryKey);
}

describe("what the form starts on (a phone)", () => {
  it("shows the movement's own values and 'Guardar cambios', not the way to register", async () => {
    renderEdit();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Monto")));
    expect((screen.getByLabelText("Monto") as HTMLInputElement).value).toBe("380,00");
    expect((screen.getByLabelText("Cuenta") as HTMLSelectElement).value).toBe("acc-itau");
    expect((screen.getByLabelText(/^Descripción/) as HTMLInputElement).value).toBe("Uber");
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /^Guardar (gasto|ingreso|transferencia)/ }),
    ).toBeNull();
  });

  it("starts on the movement's date: 19 of October is 'Otra fecha' with the date written in", () => {
    renderEdit();
    expect((screen.getByRole("radio", { name: "Otra fecha" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByLabelText("Fecha del movimiento") as HTMLInputElement).value).toBe(
      "2026-10-19",
    );
  });

  it("starts on 'Hoy' when the movement is of today", () => {
    renderEdit({ movement: { ...UBER, date: "2026-10-26" } });
    expect((screen.getByRole("radio", { name: "Hoy" }) as HTMLInputElement).checked).toBe(true);
  });

  it("starts with the category of the movement pressed, in the grid", () => {
    renderEdit();
    const grid = screen.getByRole("group", { name: "Categoría" });
    expect(
      within(grid).getByRole("button", { name: "Transporte" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(within(grid).getByText("Transporte › Taxi y apps")).toBeTruthy();
  });

  it("does not offer to change the type: a note says which it is and how to change it", () => {
    renderEdit();
    expect(screen.queryByRole("radio", { name: /^(Gasto|Ingreso|Transferencia)$/ })).toBeNull();
    expect(screen.queryByRole("group", { name: "Tipo" })).toBeNull();
    const note = document.querySelector("[data-slot='movement-type-note']");
    expect(note?.textContent).toBe(
      "GastoEl tipo no se cambia. Para cambiarlo, elimínalo y regístralo de nuevo.",
    );
  });

  it("names the type of an income and of a transfer in the note", () => {
    const income = renderEdit({ movement: SUELDO });
    expect(document.querySelector("[data-slot='movement-type-note']")?.textContent).toMatch(
      /^Ingreso/,
    );
    expect((screen.getByLabelText("Monto") as HTMLInputElement).value).toBe("50000,00");
    expect((screen.getByLabelText(/^Descripción/) as HTMLInputElement).value).toBe("");
    income.unmount();
    renderEdit({ movement: PAGO });
    expect(document.querySelector("[data-slot='movement-type-note']")?.textContent).toMatch(
      /^Transferencia/,
    );
    expect((screen.getByLabelText("Desde") as HTMLSelectElement).value).toBe("acc-itau");
    expect((screen.getByLabelText("Hacia") as HTMLSelectElement).value).toBe("acc-visa");
    expect(screen.getByText(/Pagar la tarjeta es una transferencia/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Categoría" })).toBeNull();
  });

  it("does not start on the last account used: it is the movement's", () => {
    window.localStorage.setItem("kanza:lastAccount:v1:space-1", "acc-efectivo");
    renderEdit();
    expect((screen.getByLabelText("Cuenta") as HTMLSelectElement).value).toBe("acc-itau");
  });

  it("renders nothing for an adjustment: it has no form (MovementDetail is its page)", () => {
    const { container } = renderEdit({
      movement: { ...UBER, type: "adjustment", category: null },
    });
    expect(container.querySelector("form")).toBeNull();
  });
});

describe("what the form shows on desktop (panel)", () => {
  it("puts 'Eliminar movimiento' at the end of the body and 'Cancelar · Guardar cambios' below", () => {
    renderEdit({ variant: "panel" });
    const form = document.querySelector("form") as HTMLFormElement;
    const remove = screen.getByRole("button", { name: "Eliminar movimiento" });
    const body = document.querySelector("[data-slot='sheet-body']") as HTMLElement;
    expect(body.contains(remove)).toBe(true);
    expect(remove.textContent).toBe("Eliminar movimiento");
    const footer = document.querySelector("[data-slot='sheet-footer']") as HTMLElement;
    expect(
      within(footer)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Cancelar", "Guardar cambios"]);
    expect(form.contains(remove)).toBe(true);
    expect(remove.className).toContain("self-start");
    expect(remove.className).toContain("text-destructive");
  });

  it("shows the category in the grouped select, with the subcategory chosen", () => {
    renderEdit({ variant: "panel" });
    expect((screen.getByLabelText("Categoría") as HTMLSelectElement).value).toBe(TAXI.id);
    expect((screen.getByLabelText("Fecha") as HTMLInputElement).value).toBe("2026-10-19");
  });
});

describe("'Eliminar'", () => {
  it("on a phone is at the left of the footer, reads 'Eliminar movimiento' to assistive technology and asks the container", () => {
    const { onDelete } = renderEdit();
    const remove = screen.getByRole("button", { name: "Eliminar movimiento" });
    // What is seen is "Eliminar"; the name that contains it is "Eliminar movimiento".
    expect(remove.textContent).toBe("Eliminar");
    expect(remove.getAttribute("aria-label")).toBe("Eliminar movimiento");
    const footer = document.querySelector("[data-slot='sheet-footer']") as HTMLElement;
    const buttons = within(footer).getAllByRole("button");
    expect(buttons[0]).toBe(remove);
    expect(buttons[1]?.textContent).toBe("Guardar cambios");
    expect(remove.className).toContain("text-destructive");
    fireEvent.click(remove);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("while the container deletes, both buttons wait: the delete is busy and a save sends nothing", async () => {
    const { onDone, onUnchanged } = renderEdit({ deleting: true });
    const remove = screen.getByRole("button", { name: "Eliminar movimiento" });
    expect(remove.getAttribute("aria-busy")).toBe("true");
    expect(
      screen.getByRole("button", { name: "Guardar cambios" }).getAttribute("aria-disabled"),
    ).toBe("true");
    type("Monto", "400,00");
    save();
    await act(async () => {});
    expect(mocks.put).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(onUnchanged).not.toHaveBeenCalled();
  });

  it("is off while the movement is being saved", async () => {
    mocks.put.mockReturnValue(new Promise(() => {}));
    renderEdit();
    type("Monto", "400,00");
    save();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Eliminar movimiento" }).getAttribute("aria-disabled"),
      ).toBe("true"),
    );
  });

  it("does not exist when registering", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MovementForm
          space={SPACE}
          accounts={ACCOUNTS}
          categories={CATEGORIES}
          variant="sheet"
          picking={null}
          onPickingChange={() => {}}
          onDone={() => {}}
          onNeedAccount={() => {}}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("button", { name: /Eliminar/ })).toBeNull();
    expect(screen.getByRole("radio", { name: "Gasto" })).toBeTruthy();
  });
});

describe("saving the changes", () => {
  it("replaces the whole movement with PUT: the movement's id in the path, its type and no Idempotency-Key", async () => {
    const randomUUID = vi.spyOn(globalThis.crypto, "randomUUID");
    const { onDone, invalidate } = renderEdit();
    type("Monto", "400,50");
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(mocks.put).toHaveBeenCalledTimes(1);
    const [path, init] = mocks.put.mock.calls[0]!;
    expect(path).toBe("/spaces/{space_id}/transactions/{transaction_id}");
    expect(init.params).toEqual({ path: { space_id: "space-1", transaction_id: "mov-uber" } });
    expect(init.body).toEqual({
      type: "expense",
      account_id: "acc-itau",
      category_id: TAXI.id,
      amount_minor: 40050,
      date: "2026-10-19",
      description: "Uber",
    });
    expect(init.params.header).toBeUndefined();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(randomUUID).not.toHaveBeenCalled();
    expect(keysInvalidated(invalidate)).toEqual([
      ["spaces", "space-1", "accounts"],
      ["spaces", "space-1", "transactions"],
    ]);
  });

  it("says what was saved, by the saved movement, with no 'Deshacer', and does not remember the account", async () => {
    mocks.put.mockResolvedValue(ok({ ...UBER, description: "Uber al aeropuerto" }));
    const { onDone } = renderEdit();
    type(/^Descripción/, "Uber al aeropuerto");
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Guardaste los cambios de «Uber al aeropuerto»",
    );
    expect(window.localStorage.getItem("kanza:lastAccount:v1:space-1")).toBeNull();
  });

  it("changes the account, the category and the date", async () => {
    const { onDone } = renderEdit();
    type("Cuenta", "acc-efectivo");
    fireEvent.click(screen.getByRole("button", { name: "Ropa" }));
    fireEvent.click(screen.getByRole("radio", { name: "Hoy" }));
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.put.mock.calls[0]![1].body).toMatchObject({
      account_id: "acc-efectivo",
      category_id: ROPA.id,
      date: "2026-10-26",
    });
  });

  it("clearing the description leaves it out of the body, so the backend clears the note", async () => {
    const { onDone } = renderEdit();
    type(/^Descripción/, "   ");
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.put.mock.calls[0]![1].body).not.toHaveProperty("description");
  });

  it("saves a transfer with its two accounts and no category", async () => {
    mocks.put.mockResolvedValue(ok(PAGO));
    const { onDone } = renderEdit({ movement: PAGO });
    type("Hacia", "acc-brou");
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.put.mock.calls[0]![1].body).toEqual({
      type: "transfer",
      from_account_id: "acc-itau",
      to_account_id: "acc-brou",
      amount_minor: 1_850_000,
      date: "2026-10-19",
      description: "Pago de la tarjeta",
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Guardaste los cambios de «Pago de la tarjeta»",
    );
  });

  it("saves an income with its category", async () => {
    mocks.put.mockResolvedValue(ok(SUELDO));
    const { onDone } = renderEdit({ movement: SUELDO });
    type("Monto", "51000");
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.put.mock.calls[0]![1].body).toMatchObject({
      type: "income",
      category_id: "cat-Sueldo",
      amount_minor: 5_100_000,
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Guardaste los cambios de «Sueldo»");
  });

  it("checks the changes like when registering: an empty amount is the message of the field", async () => {
    renderEdit();
    type("Monto", "");
    save();
    await waitFor(() => expect(screen.getByText("Escribe un monto.")).toBeTruthy());
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("sends once, even with two clicks in the same instant", async () => {
    mocks.put.mockResolvedValue(ok(UBER));
    const { onDone } = renderEdit();
    type("Monto", "400,00");
    const button = screen.getByRole("button", { name: "Guardar cambios" });
    await act(async () => {
      button.click();
      button.click();
    });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.put).toHaveBeenCalledTimes(1);
  });

  it("with nothing changed sends nothing: the container is told and just closes", async () => {
    const { onUnchanged, onDone, invalidate } = renderEdit();
    save();
    await waitFor(() => expect(onUnchanged).toHaveBeenCalledTimes(1));
    expect(mocks.put).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("counts '380' and '380,00' as the same amount, and a changed-then-restored value as unchanged", async () => {
    const { onUnchanged } = renderEdit();
    type("Monto", "380");
    type(/^Descripción/, "Otra");
    type(/^Descripción/, "Uber");
    save();
    await waitFor(() => expect(onUnchanged).toHaveBeenCalled());
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("an amount that differs only by the decimals is a change", async () => {
    const { onDone, onUnchanged } = renderEdit();
    type("Monto", "380,01");
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onUnchanged).not.toHaveBeenCalled();
    expect(mocks.put.mock.calls[0]![1].body.amount_minor).toBe(38001);
  });

  it("is exact at the largest amount the backend takes", async () => {
    const huge: MovementRead = { ...UBER, amount_minor: -Number.MAX_SAFE_INTEGER };
    mocks.put.mockResolvedValue(ok(huge));
    const { onDone, onUnchanged } = renderEdit({ movement: huge });
    expect((screen.getByLabelText("Monto") as HTMLInputElement).value).toBe("90071992547409,91");
    save();
    await waitFor(() => expect(onUnchanged).toHaveBeenCalled());
    expect(onDone).not.toHaveBeenCalled();
    type("Monto", "90071992547409,90");
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.put.mock.calls[0]![1].body.amount_minor).toBe(Number.MAX_SAFE_INTEGER - 1);
  });
});

describe("when the save fails", () => {
  it("marks the field a 422 names and puts back the button", async () => {
    mocks.put.mockResolvedValue(
      failure(422, {
        detail: [{ type: "greater_than", loc: ["body", "expense", "amount_minor"], msg: "x" }],
      }),
    );
    const { onDone } = renderEdit();
    type("Monto", "400");
    save();
    await waitFor(() =>
      expect(screen.getByLabelText("Monto").getAttribute("aria-invalid")).toBe("true"),
    );
    expect(onDone).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Guardar cambios" }).getAttribute("aria-busy"),
    ).toBeNull();
  });

  it("clears an account the backend refuses (422 on its field) and asks the accounts again", async () => {
    mocks.put.mockResolvedValue(
      failure(422, {
        detail: [{ type: "account_archived", loc: ["body", "expense", "account_id"], msg: "x" }],
      }),
    );
    const { invalidate } = renderEdit();
    type("Monto", "400");
    save();
    await waitFor(() =>
      expect(screen.getByText("Esa cuenta está archivada. Elige otra.")).toBeTruthy(),
    );
    expect((screen.getByLabelText("Cuenta") as HTMLSelectElement).value).toBe("");
    expect(keysInvalidated(invalidate)).toContainEqual(["spaces", "space-1", "accounts"]);
  });

  it("says the movement is gone on a 404, asks the movements again, and lets the person close", async () => {
    mocks.put.mockResolvedValue(
      failure(404, { code: "transaction_not_found", detail: "Transaction not found" }),
    );
    const { onDone, invalidate } = renderEdit();
    type("Monto", "400");
    save();
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("No encontramos ese movimiento")).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    expect(keysInvalidated(invalidate)).toEqual([["spaces", "space-1", "transactions"]]);
    expect(
      screen.getByRole("button", { name: "Guardar cambios" }).getAttribute("aria-busy"),
    ).toBeNull();
  });

  it("explains a 409 transaction_not_editable and asks the movements and the accounts again", async () => {
    mocks.put.mockResolvedValue(failure(409, { code: "transaction_not_editable", detail: "x" }));
    const { invalidate } = renderEdit();
    type("Monto", "400");
    save();
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Este movimiento no se puede cambiar")).toBeTruthy();
    expect(keysInvalidated(invalidate)).toEqual([
      ["spaces", "space-1", "transactions"],
      ["spaces", "space-1", "accounts"],
    ]);
  });

  it("explains a 409 account_archived as being about this movement, not about 'Cuadrar saldo'", async () => {
    mocks.put.mockResolvedValue(failure(409, { code: "account_archived", detail: "x" }));
    renderEdit();
    type("Monto", "400");
    save();
    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText("Desarchívala desde Cuentas para poder editar este movimiento."),
    ).toBeTruthy();
    expect(alert.textContent).not.toContain("cuadrar");
  });

  it("can be sent again after a failure, with the Alert gone while it runs", async () => {
    mocks.put.mockResolvedValueOnce(failure(500)).mockResolvedValueOnce(ok(UBER));
    const { onDone } = renderEdit();
    type("Monto", "400");
    save();
    await screen.findByRole("alert");
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(mocks.put).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sends an expired session to /login", async () => {
    mocks.put.mockResolvedValue(failure(401, { code: "invalid_session", detail: "x" }));
    renderEdit();
    type("Monto", "400");
    save();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says there is no connection and keeps the request waiting, with the button busy", async () => {
    onlineManager.setOnline(false);
    renderEdit();
    type("Monto", "400");
    save();
    expect(await screen.findByText("No pudimos conectar")).toBeTruthy();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Guardar cambios" }).getAttribute("aria-busy")).toBe(
      "true",
    );
  });
});

describe("a category that was archived after the movement was made", () => {
  const ARCHIVED_TAXI = { ...TAXI, archived_at: ARCHIVED_AT };
  const WITH_ARCHIVED = CATEGORIES.map((c) => (c.id === TAXI.id ? ARCHIVED_TAXI : c));

  it("keeps showing it in the grid as '(archivada)', chosen, and sends it back untouched", async () => {
    // The sheet asks for the categories with the archived ones when it edits.
    const { onDone } = renderEdit({ categories: WITH_ARCHIVED });
    expect(screen.getByText("Transporte › Taxi y apps (archivada)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Transporte" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    type("Monto", "400");
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.put.mock.calls[0]![1].body.category_id).toBe(TAXI.id);
  });

  it("shows it in the select of the panel as '(archivada)' and chosen, the only archived option", () => {
    const archivedRopa = { ...ROPA, archived_at: ARCHIVED_AT };
    renderEdit({
      variant: "panel",
      categories: WITH_ARCHIVED.map((c) => (c.id === ROPA.id ? archivedRopa : c)),
    });
    const select = screen.getByLabelText("Categoría") as HTMLSelectElement;
    expect(select.value).toBe(TAXI.id);
    const options = within(select).getAllByRole("option");
    expect(
      options.filter((o) => o.textContent?.includes("archivada")).map((o) => o.textContent),
    ).toEqual(["Taxi y apps (archivada)"]);
  });

  it("can be left for an active one, and the archived one is not offered again by another category", async () => {
    const { onDone } = renderEdit({ categories: WITH_ARCHIVED });
    fireEvent.click(screen.getByRole("button", { name: "Comida" }));
    // 'Comida' has subcategories: the second step opens; choosing 'Solo Comida' goes back.
    fireEvent.click(await screen.findByRole("radio", { name: "Solo Comida" }));
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.put.mock.calls[0]![1].body.category_id).toBe(COMIDA.id);
  });
});

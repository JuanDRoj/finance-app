import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import type { CategoryRead } from "@/lib/core/data/categories";
import { MovementForm, type MovementFormProps } from "./movement-form";

// The edges are mocked: the typed browser client, the toast and the list of "Más" (to test the link
// to Categorías before that screen exists). What is under test is the form: what it shows for each
// type and width, what it sends, how a failure comes back to the fields or the Alert, and that it
// cannot register two movements.
const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  toastSuccess: vi.fn(),
  replace: vi.fn(),
  more: [] as unknown[],
}));

vi.mock("@/lib/api/browser", () => ({ browserApi: { POST: mocks.post } }));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess } }));
vi.mock("@/components/nav-sections", () => ({ MORE_SECTIONS: mocks.more }));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  onlineManager.setOnline(true);
  window.localStorage.clear();
  mocks.more.length = 0;
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
const CATEGORIES = [
  COMIDA,
  TRANSPORTE,
  ROPA,
  TRABAJO,
  category("Supermercado", { parent_id: COMIDA.id }),
  category("Taxi y apps", { parent_id: TRANSPORTE.id, icon: "taxi" }),
  category("Combustible", { parent_id: TRANSPORTE.id, icon: "gas-pump" }),
  category("Sueldo", { parent_id: TRABAJO.id }, "income"),
];

function created(body: unknown = { id: "tx-1" }) {
  return { data: body, response: new Response(null, { status: 201 }) };
}

function failure(status: number, body?: unknown) {
  return { error: body, response: new Response(null, { status }) };
}

beforeEach(() => {
  mocks.post.mockReset().mockResolvedValue(created());
  mocks.toastSuccess.mockReset();
  mocks.replace.mockReset();
  // Only `Date` is faked: "today" is fixed (the 26th in Montevideo), the timers stay real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T15:00:00Z"));
  vi.stubGlobal("location", { ...window.location, replace: mocks.replace });
});

type Props = Partial<MovementFormProps>;

/** The container of the second step, which keeps `picking` for the form. */
function Harness(props: Props) {
  const [picking, setPicking] = useState<string | null>(null);
  return (
    <MovementForm
      space={SPACE}
      accounts={ACCOUNTS}
      categories={CATEGORIES}
      variant="sheet"
      onDone={() => {}}
      onNeedAccount={() => {}}
      {...props}
      picking={picking}
      onPickingChange={setPicking}
    />
  );
}

function renderForm(props: Props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const onDone = vi.fn();
  const onNeedAccount = vi.fn();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Harness onDone={onDone} onNeedAccount={onNeedAccount} {...props} />
    </QueryClientProvider>,
  );
  return { ...view, onDone, onNeedAccount, invalidate };
}

function type(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function pickType(name: "Gasto" | "Ingreso" | "Transferencia") {
  fireEvent.click(screen.getByRole("radio", { name }));
}

function cell(name: string) {
  return screen.getByRole("button", { name });
}

function save(name: string | RegExp = /^Guardar/) {
  fireEvent.click(screen.getByRole("button", { name }));
}

/** The body of the one request that was sent. */
function sentBody() {
  expect(mocks.post).toHaveBeenCalledTimes(1);
  return mocks.post.mock.calls[0]?.[1]?.body;
}

/** The query keys the form asked to invalidate, in order. */
function keysInvalidated(invalidate: { mock: { calls: unknown[][] } }) {
  return invalidate.mock.calls.map(([filters]) => (filters as { queryKey: unknown }).queryKey);
}

describe("what the form shows on a phone (sheet)", () => {
  it("starts as a Gasto with the amount focused, today's date and the 'Guardar gasto' button", async () => {
    renderForm();
    expect((screen.getByRole("radio", { name: "Gasto" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByRole("radio", { name: /^(Gasto|Ingreso|Transferencia)$/ })).toHaveLength(
      3,
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Monto")));
    expect(screen.getByLabelText("Monto").getAttribute("placeholder")).toBe("0,00");
    expect((screen.getByRole("radio", { name: "Hoy" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: "Guardar gasto" })).toBeTruthy();
  });

  it("leaves the label of the type to assistive technology only", () => {
    renderForm();
    const group = screen.getByRole("group", { name: "Tipo" });
    expect(within(group).getByText("Tipo").className).toContain("sr-only");
  });

  it("shows the expense categories as a grid of principals and the account below", () => {
    renderForm();
    const grid = screen.getByRole("group", { name: "Categoría" });
    expect(
      within(grid)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Comida", "Transporte", "Ropa"]);
    expect(within(grid).queryByRole("radio")).toBeNull();
    const category = screen.getByRole("group", { name: "Categoría" });
    const account = screen.getByLabelText("Cuenta");
    // On a phone the category comes before the account (D19).
    expect(
      category.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("starts the account on the first one, or on the last one used if it is still active", () => {
    const { unmount } = renderForm();
    expect((screen.getByLabelText("Cuenta") as HTMLSelectElement).value).toBe("acc-itau");
    unmount();
    window.localStorage.setItem("kanza:lastAccount:v1:space-1", "acc-efectivo");
    renderForm();
    expect((screen.getByLabelText("Cuenta") as HTMLSelectElement).value).toBe("acc-efectivo");
  });

  it("ignores a last used account that is not in the list (another space's, or archived)", () => {
    window.localStorage.setItem("kanza:lastAccount:v1:space-1", "acc-gone");
    renderForm({ accounts: [ITAU, { ...BROU, archived_at: "2026-10-01T10:00:00Z" }] });
    expect((screen.getByLabelText("Cuenta") as HTMLSelectElement).value).toBe("acc-itau");
  });

  it("lists the accounts by name, with no empty option while one is chosen", () => {
    renderForm();
    const options = within(screen.getByLabelText("Cuenta")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Itaú",
      "BROU Caja de ahorro",
      "Efectivo",
      "Visa Itaú",
    ]);
  });

  it("writes the description's example according to the type", () => {
    renderForm();
    const description = screen.getByLabelText(/Descripción/);
    expect(description.getAttribute("placeholder")).toBe("Ej.: Supermercado");
    expect(screen.getByText("(opcional)")).toBeTruthy();
    pickType("Ingreso");
    expect(description.getAttribute("placeholder")).toBe("Ej.: Sueldo de octubre");
    pickType("Transferencia");
    expect(description.getAttribute("placeholder")).toBe("Ej.: Pago de la tarjeta");
  });

  it("puts the symbol of the space's currency in front of the amount, never a fixed '$'", () => {
    const { container } = renderForm({
      space: { ...SPACE, currency: { code: "USD", exponent: 2 } },
    });
    expect(container.querySelector("[aria-hidden='true']")?.textContent).toBe("US$");
  });

  it("follows the exponent of the currency in the placeholder of the amount", () => {
    renderForm({ space: { ...SPACE, currency: { code: "CLP", exponent: 0 } } });
    expect(screen.getByLabelText("Monto").getAttribute("placeholder")).toBe("0");
  });
});

describe("changing the type", () => {
  it("shows the income categories and 'Guardar ingreso', and forgets the category", () => {
    renderForm();
    fireEvent.click(cell("Ropa"));
    expect(cell("Ropa").getAttribute("aria-pressed")).toBe("true");
    pickType("Ingreso");
    expect(screen.getByRole("button", { name: "Guardar ingreso" })).toBeTruthy();
    expect(
      within(screen.getByRole("group", { name: "Categoría" }))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Trabajo"]);
    pickType("Gasto");
    // Back on the expenses nothing is chosen: the choice was forgotten at the first switch.
    expect(cell("Ropa").getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps the amount, the account, the date and the description", () => {
    renderForm();
    type("Monto", "150,50");
    type("Cuenta", "acc-efectivo");
    type(/Descripción/, "Almuerzo");
    fireEvent.click(screen.getByRole("radio", { name: "Ayer" }));
    pickType("Ingreso");
    expect((screen.getByLabelText("Monto") as HTMLInputElement).value).toBe("150,50");
    expect((screen.getByLabelText("Cuenta") as HTMLSelectElement).value).toBe("acc-efectivo");
    expect((screen.getByLabelText(/Descripción/) as HTMLInputElement).value).toBe("Almuerzo");
    expect((screen.getByRole("radio", { name: "Ayer" }) as HTMLInputElement).checked).toBe(true);
  });

  it("asks for 'Desde' and 'Hacia' in a transfer, with the note and no category", () => {
    renderForm();
    pickType("Transferencia");
    expect(screen.getByLabelText("Desde")).toBeTruthy();
    expect(screen.getByLabelText("Hacia")).toBeTruthy();
    expect(screen.queryByLabelText("Cuenta")).toBeNull();
    expect(screen.queryByRole("group", { name: "Categoría" })).toBeNull();
    expect(
      screen.getByText(
        "Pagar la tarjeta es una transferencia: no cuenta como gasto. El gasto ya contó cuando compraste.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar transferencia" })).toBeTruthy();
  });

  it("starts 'Desde' on the account the form had, and 'Hacia' on nothing when there are several", () => {
    renderForm();
    type("Cuenta", "acc-brou");
    pickType("Transferencia");
    expect((screen.getByLabelText("Desde") as HTMLSelectElement).value).toBe("acc-brou");
    const hacia = screen.getByLabelText("Hacia") as HTMLSelectElement;
    expect(hacia.value).toBe("");
    expect(within(hacia).getAllByRole("option")[0]?.textContent).toBe("Elige una cuenta");
  });

  it("does not offer the account of 'Desde' in 'Hacia'", () => {
    renderForm();
    pickType("Transferencia");
    const names = within(screen.getByLabelText("Hacia"))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(names).not.toContain("Itaú");
    expect(names).toEqual(["Elige una cuenta", "BROU Caja de ahorro", "Efectivo", "Visa Itaú"]);
  });

  it("chooses 'Hacia' by itself only when there is a single possible account", () => {
    renderForm({ accounts: [ITAU, VISA] });
    pickType("Transferencia");
    expect((screen.getByLabelText("Hacia") as HTMLSelectElement).value).toBe("acc-visa");
  });

  it("clears 'Hacia' if 'Desde' becomes the same account, and follows 'Desde' when only one is left", () => {
    renderForm();
    pickType("Transferencia");
    type("Hacia", "acc-brou");
    type("Desde", "acc-brou");
    expect((screen.getByLabelText("Hacia") as HTMLSelectElement).value).toBe("");
    expect(
      within(screen.getByLabelText("Hacia"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).not.toContain("BROU Caja de ahorro");
  });
});

describe("the second step of the categories (a principal with subcategories)", () => {
  it("opens when a principal with subcategories is pressed, which is also chosen at once", () => {
    renderForm();
    fireEvent.click(cell("Transporte"));
    expect(screen.getByText("Elige una subcategoría o deja solo Transporte.")).toBeTruthy();
    // The form stays mounted but hidden, so what was typed is not lost.
    const form = document.querySelector("form") as HTMLFormElement;
    expect(form.className.split(" ")).toContain("hidden");
    expect(
      (screen.getByRole("radio", { name: "Solo Transporte" }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("goes back to the form with the subcategory chosen and written under the grid", () => {
    renderForm();
    type("Monto", "380");
    fireEvent.click(cell("Transporte"));
    fireEvent.click(screen.getByRole("radio", { name: "Taxi y apps" }));
    expect(screen.queryByText(/Elige una subcategoría/)).toBeNull();
    expect((screen.getByLabelText("Monto") as HTMLInputElement).value).toBe("380");
    expect(cell("Transporte").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Transporte › Taxi y apps")).toBeTruthy();
    // The focus returns to the cell that was pressed.
    expect(document.activeElement).toBe(cell("Transporte"));
  });

  it("goes back with 'Solo Transporte' even though it was the row already checked", () => {
    renderForm();
    fireEvent.click(cell("Transporte"));
    fireEvent.click(screen.getByRole("radio", { name: "Solo Transporte" }));
    expect(screen.queryByText(/Elige una subcategoría/)).toBeNull();
    expect(screen.getByText("Solo Transporte")).toBeTruthy();
  });

  it("opens again with 'Cambiar', on the choice already made", () => {
    renderForm();
    fireEvent.click(cell("Transporte"));
    fireEvent.click(screen.getByRole("radio", { name: "Combustible" }));
    fireEvent.click(screen.getByRole("button", { name: "Cambiar" }));
    expect((screen.getByRole("radio", { name: "Combustible" }) as HTMLInputElement).checked).toBe(
      true,
    );
    // The focus is on the row that is chosen.
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Combustible" }));
  });

  it("does not open a second step for a principal with no subcategories", () => {
    renderForm();
    fireEvent.click(cell("Ropa"));
    expect(screen.queryByText(/Elige una subcategoría/)).toBeNull();
    expect(cell("Ropa").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("registering a movement", () => {
  it("registers a typical expense: amount, category and save, with the account by default", async () => {
    const { onDone, invalidate } = renderForm();
    type("Monto", "2340,50");
    fireEvent.click(cell("Ropa"));
    save("Guardar gasto");

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(mocks.post.mock.calls[0]?.[0]).toBe("/spaces/{space_id}/transactions");
    expect(mocks.post.mock.calls[0]?.[1]?.params).toEqual({ path: { space_id: "space-1" } });
    expect(sentBody()).toEqual({
      type: "expense",
      account_id: "acc-itau",
      category_id: "cat-Ropa",
      amount_minor: 234050,
      date: "2026-10-26",
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Registraste «Ropa»");
    // The balances (Inicio and Cuentas) and the list of movements, not the categories.
    expect(keysInvalidated(invalidate)).toEqual([
      ["spaces", "space-1", "accounts"],
      ["spaces", "space-1", "transactions"],
    ]);
  });

  it("names the toast after the description when there is one, trimmed", async () => {
    const { onDone } = renderForm();
    type("Monto", "100");
    fireEvent.click(cell("Ropa"));
    type(/Descripción/, "  Tienda Inglesa  ");
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentBody()).toMatchObject({ description: "Tienda Inglesa" });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Registraste «Tienda Inglesa»");
  });

  it("names the toast after the subcategory chosen", async () => {
    const { onDone } = renderForm();
    type("Monto", "380");
    fireEvent.click(cell("Transporte"));
    fireEvent.click(screen.getByRole("radio", { name: "Taxi y apps" }));
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentBody()).toMatchObject({ category_id: "cat-Taxi y apps" });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Registraste «Taxi y apps»");
  });

  it("registers an income in the account and on the date chosen", async () => {
    const { onDone } = renderForm();
    pickType("Ingreso");
    type("Monto", "50000");
    type("Cuenta", "acc-brou");
    fireEvent.click(cell("Trabajo"));
    fireEvent.click(screen.getByRole("radio", { name: "Solo Trabajo" }));
    fireEvent.click(screen.getByRole("radio", { name: "Ayer" }));
    save("Guardar ingreso");
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentBody()).toEqual({
      type: "income",
      account_id: "acc-brou",
      category_id: "cat-Trabajo",
      amount_minor: 5000000,
      date: "2026-10-25",
    });
  });

  it("registers a transfer, with no category, and names the toast after the two accounts", async () => {
    const { onDone } = renderForm();
    pickType("Transferencia");
    type("Monto", "12000");
    type("Hacia", "acc-visa");
    save("Guardar transferencia");
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentBody()).toEqual({
      type: "transfer",
      from_account_id: "acc-itau",
      to_account_id: "acc-visa",
      amount_minor: 1200000,
      date: "2026-10-26",
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Registraste «Itaú → Visa Itaú»");
  });

  it("cuts a long description in the toast, but sends it whole", async () => {
    const { onDone } = renderForm();
    type("Monto", "100");
    fireEvent.click(cell("Ropa"));
    const long = "x".repeat(150);
    type(/Descripción/, long);
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentBody().description).toBe(long);
    const text = mocks.toastSuccess.mock.calls[0]?.[0] as string;
    expect(text).toBe(`Registraste «${"x".repeat(39)}…»`);
  });

  it("remembers the account used, to start on it next time", async () => {
    const { onDone } = renderForm();
    type("Monto", "100");
    type("Cuenta", "acc-efectivo");
    fireEvent.click(cell("Ropa"));
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(window.localStorage.getItem("kanza:lastAccount:v1:space-1")).toBe("acc-efectivo");
  });

  it("remembers the 'Desde' account of a transfer", async () => {
    const { onDone } = renderForm();
    pickType("Transferencia");
    type("Monto", "100");
    type("Desde", "acc-brou");
    type("Hacia", "acc-visa");
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(window.localStorage.getItem("kanza:lastAccount:v1:space-1")).toBe("acc-brou");
  });

  it("does not remember anything, nor toast, when it fails", async () => {
    mocks.post.mockResolvedValue(failure(500, { code: "internal_error", detail: "boom" }));
    const { onDone } = renderForm();
    type("Monto", "100");
    fireEvent.click(cell("Ropa"));
    save();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("kanza:lastAccount:v1:space-1")).toBeNull();
  });

  it("registers it once: the button is busy while it runs and after it worked", async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.post.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { onDone } = renderForm();
    type("Monto", "100");
    fireEvent.click(cell("Ropa"));
    const button = screen.getByRole("button", { name: "Guardar gasto" });
    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute("aria-busy")).toBe("true"));
    fireEvent.click(button);
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    expect(mocks.post).toHaveBeenCalledTimes(1);

    finish(created());
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    // Done: the container is leaving, a late tap must not register a second one.
    fireEvent.click(button);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("registers it once even if the form is submitted twice in a row, before it renders busy", async () => {
    // A held Enter fires several submits at once; `handleSubmit` validates asynchronously, so the
    // `busy` of the render before cannot be what stops the second one.
    const { onDone } = renderForm();
    type("Monto", "100");
    fireEvent.click(cell("Ropa"));
    const form = document.querySelector("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    // Let anything still in flight land before counting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("registers it once for two submits in a row while the request is still running", async () => {
    mocks.post.mockReturnValue(new Promise(() => {}));
    renderForm();
    type("Monto", "100");
    fireEvent.click(cell("Ropa"));
    const form = document.querySelector("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(mocks.post).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it("lets it be sent again once a failure released the guard", async () => {
    mocks.post.mockResolvedValueOnce(failure(500, { code: "internal_error", detail: "boom" }));
    const { onDone } = renderForm();
    type("Monto", "100");
    fireEvent.click(cell("Ropa"));
    const form = document.querySelector("form") as HTMLFormElement;
    fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.submit(form);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it("registers it with Enter in the amount, as the quickest way", async () => {
    const { onDone } = renderForm();
    type("Monto", "100");
    fireEvent.click(cell("Ropa"));
    fireEvent.submit(screen.getByLabelText("Monto").closest("form") as HTMLFormElement);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});

describe("what the form refuses before asking the backend", () => {
  it("shows every error beside its field in Spanish, and registers nothing", async () => {
    renderForm();
    save();
    expect(await screen.findByText("Escribe un monto.")).toBeTruthy();
    expect(screen.getByText("Elige una categoría.")).toBeTruthy();
    expect(mocks.post).not.toHaveBeenCalled();
    // The first invalid field takes the focus.
    expect(screen.getByLabelText("Monto").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(screen.getByLabelText("Monto"));
    // The error of the category is linked to its group.
    const grid = screen.getByRole("group", { name: "Categoría" });
    expect(grid.getAttribute("data-invalid")).toBe("true");
    expect(document.getElementById(grid.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "Elige una categoría.",
    );
  });

  it.each([
    ["0", "El monto debe ser mayor que 0."],
    ["-10", "Escribe el monto sin signo."],
    ["10,999", "Usa como máximo 2 decimales."],
    ["abc", "Escribe solo números, por ejemplo 1550,50."],
  ])("refuses the amount %j: %s", async (amount, message) => {
    renderForm();
    type("Monto", amount);
    fireEvent.click(cell("Ropa"));
    save();
    expect(await screen.findByText(message)).toBeTruthy();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("moves the focus to the category group when only the category is missing", async () => {
    renderForm();
    type("Monto", "100");
    save();
    await screen.findByText("Elige una categoría.");
    expect(document.activeElement).toBe(screen.getByRole("group", { name: "Categoría" }));
  });

  it("asks for 'Hacia' in a transfer", async () => {
    renderForm();
    pickType("Transferencia");
    type("Monto", "100");
    save();
    expect(await screen.findByText("Elige la cuenta de destino.")).toBeTruthy();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("refuses an empty date (a half-typed input) with its own text", async () => {
    renderForm();
    type("Monto", "100");
    fireEvent.click(cell("Ropa"));
    fireEvent.click(screen.getByRole("radio", { name: "Otra fecha" }));
    fireEvent.change(screen.getByLabelText("Fecha del movimiento"), { target: { value: "" } });
    save();
    expect(await screen.findByText("Elige una fecha.")).toBeTruthy();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("refuses a description of more than 200 characters", async () => {
    renderForm();
    type("Monto", "100");
    fireEvent.click(cell("Ropa"));
    type(/Descripción/, "x".repeat(201));
    save();
    expect(await screen.findByText("Usa como máximo 200 caracteres.")).toBeTruthy();
    expect(mocks.post).not.toHaveBeenCalled();
  });
});

describe("when the backend refuses", () => {
  function fill() {
    type("Monto", "100");
    fireEvent.click(cell("Ropa"));
    save();
  }

  function unprocessable(...issues: { type: string; loc: (string | number)[] }[]) {
    return failure(422, { detail: issues.map((issue) => ({ ...issue, msg: "English message" })) });
  }

  it("marks the category the backend says is archived, forgets it and asks the list again", async () => {
    mocks.post.mockResolvedValue(
      unprocessable({ type: "category_archived", loc: ["body", "expense", "category_id"] }),
    );
    const { invalidate } = renderForm();
    fill();
    expect(await screen.findByText("Esa categoría está archivada. Elige otra.")).toBeTruthy();
    expect(cell("Ropa").getAttribute("aria-pressed")).toBe("false");
    expect(keysInvalidated(invalidate)).toContainEqual(["spaces", "space-1", "categories"]);
    // A message in English never reaches the screen.
    expect(screen.queryByText("English message")).toBeNull();
  });

  it("marks the account the backend does not find, empties the select and asks the list again", async () => {
    mocks.post.mockResolvedValue(
      unprocessable({ type: "account_not_found", loc: ["body", "expense", "account_id"] }),
    );
    const { invalidate } = renderForm();
    fill();
    expect(await screen.findByText("Esa cuenta ya no existe. Elige otra.")).toBeTruthy();
    const select = screen.getByLabelText("Cuenta") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(within(select).getAllByRole("option")[0]?.textContent).toBe("Elige una cuenta");
    expect(keysInvalidated(invalidate)).toContainEqual(["spaces", "space-1", "accounts"]);
  });

  it("puts the same account for 'Desde' (from_account_id) on the 'Desde' field", async () => {
    mocks.post.mockResolvedValue(
      unprocessable({ type: "account_archived", loc: ["body", "transfer", "from_account_id"] }),
    );
    renderForm();
    pickType("Transferencia");
    type("Monto", "100");
    type("Hacia", "acc-visa");
    save();
    expect(await screen.findByText("Esa cuenta está archivada. Elige otra.")).toBeTruthy();
    expect(screen.getByLabelText("Desde").getAttribute("aria-invalid")).toBe("true");
  });

  it("marks 'Hacia' for the same account in both (transfer_same_account)", async () => {
    mocks.post.mockResolvedValue(
      unprocessable({ type: "transfer_same_account", loc: ["body", "transfer", "to_account_id"] }),
    );
    renderForm();
    pickType("Transferencia");
    type("Monto", "100");
    type("Hacia", "acc-visa");
    save();
    expect(await screen.findByText("Elige dos cuentas distintas.")).toBeTruthy();
    expect(screen.getByLabelText("Hacia").getAttribute("aria-invalid")).toBe("true");
  });

  it("marks the amount when the backend says it is too high", async () => {
    mocks.post.mockResolvedValue(
      unprocessable({ type: "less_than_equal", loc: ["body", "expense", "amount_minor"] }),
    );
    renderForm();
    fill();
    expect(await screen.findByText("El valor es demasiado alto.")).toBeTruthy();
    expect(screen.getByLabelText("Monto").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(screen.getByLabelText("Monto"));
  });

  it("marks several fields at once and focuses only the first", async () => {
    mocks.post.mockResolvedValue(
      unprocessable(
        { type: "date_invalid", loc: ["body", "expense", "date"] },
        { type: "string_too_long", loc: ["body", "expense", "description"] },
      ),
    );
    renderForm();
    fill();
    expect(await screen.findByText("Escribe una fecha válida.")).toBeTruthy();
    expect(screen.getByText("Es demasiado largo.")).toBeTruthy();
  });

  it("takes the focus to the date input when the backend refuses the date, though 'Hoy' hid it", async () => {
    mocks.post.mockResolvedValue(
      unprocessable({ type: "date_invalid", loc: ["body", "expense", "date"] }),
    );
    renderForm();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Monto")));
    type("Monto", "100");
    fireEvent.click(cell("Ropa"));
    expect(screen.queryByLabelText("Fecha del movimiento")).toBeNull();
    save();
    expect(await screen.findByText("Escribe una fecha válida.")).toBeTruthy();
    // The input is not in the page with "Hoy" chosen: the form shows it ("Otra fecha") and focuses it.
    const input = await screen.findByLabelText("Fecha del movimiento");
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect((screen.getByRole("radio", { name: "Otra fecha" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(input.getAttribute("aria-invalid")).toBe("true");
    // The day was not touched: it can be corrected.
    expect((input as HTMLInputElement).value).toBe("2026-10-26");
  });

  it("takes the focus to the date input of the panel when the backend refuses the date", async () => {
    mocks.post.mockResolvedValue(
      unprocessable({ type: "date_invalid", loc: ["body", "expense", "date"] }),
    );
    renderForm({ variant: "panel" });
    // The amount takes the focus as the form appears (a tick later): wait for it, as a person would.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Monto")));
    type("Monto", "100");
    type("Categoría", "cat-Ropa");
    save();
    expect(await screen.findByText("Escribe una fecha válida.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Fecha")));
  });

  it("shows what no field can show in an Alert in Spanish", async () => {
    mocks.post.mockResolvedValue(unprocessable({ type: "union_tag_invalid", loc: ["body"] }));
    renderForm();
    fill();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Revisa los datos");
    expect(alert.textContent).not.toContain("union_tag_invalid");
    expect(alert.textContent).not.toContain("English message");
  });

  it("shows the 404 of a space that is gone in an Alert, not on a field", async () => {
    mocks.post.mockResolvedValue(
      failure(404, { code: "space_not_found", detail: "Space not found" }),
    );
    renderForm();
    fill();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("No encontramos ese espacio");
    expect(alert.textContent).not.toContain("Space not found");
  });

  it("sends an expired session to /login without an Alert", async () => {
    mocks.post.mockResolvedValue(failure(401, { code: "invalid_session", detail: "x" }));
    renderForm();
    fill();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("can be tried again after a failure, and the Alert goes away", async () => {
    mocks.post.mockResolvedValueOnce(failure(500, { code: "internal_error", detail: "boom" }));
    const { onDone } = renderForm();
    fill();
    expect((await screen.findByRole("alert")).textContent).toContain("Algo salió mal");
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it("says there is no connection, in the words of any network failure, and waits", async () => {
    const { onDone } = renderForm();
    type("Monto", "100");
    fireEvent.click(cell("Ropa"));
    onlineManager.setOnline(false);
    save();
    expect(await screen.findByText("No pudimos conectar")).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("the cases at the edge (D19)", () => {
  it("explains that a transfer needs two accounts, and offers 'Nueva cuenta'", () => {
    const { onNeedAccount } = renderForm({ accounts: [ITAU] });
    pickType("Transferencia");
    expect(screen.getByText("Necesitas otra cuenta para transferir")).toBeTruthy();
    expect(screen.queryByLabelText("Desde")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Nueva cuenta" }));
    expect(onNeedAccount).toHaveBeenCalledTimes(1);
  });

  it("keeps the button off in a transfer with one account, and sends nothing", () => {
    renderForm({ accounts: [ITAU] });
    pickType("Transferencia");
    type("Monto", "100");
    const button = screen.getByRole("button", { name: "Guardar transferencia" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(screen.queryByText("Elige la cuenta de destino.")).toBeNull();
  });

  it("lets an expense be registered with one account", async () => {
    const { onDone } = renderForm({ accounts: [ITAU] });
    type("Monto", "100");
    fireEvent.click(cell("Ropa"));
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("says there are no categories of the kind instead of the grid, and keeps the button off", () => {
    renderForm({ categories: [TRABAJO] });
    expect(screen.getByText("No tienes categorías de gasto activas")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Categoría" }).querySelector("button")).toBeNull();
    const button = screen.getByRole("button", { name: "Guardar gasto" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    type("Monto", "100");
    fireEvent.click(button);
    expect(mocks.post).not.toHaveBeenCalled();
    // The other kind still works.
    pickType("Ingreso");
    expect(screen.queryByText(/No tienes categorías/)).toBeNull();
    expect(cell("Trabajo")).toBeTruthy();
  });

  it("names the kind in the empty text of the incomes", () => {
    renderForm({ categories: [ROPA] });
    pickType("Ingreso");
    expect(screen.getByText("No tienes categorías de ingreso activas")).toBeTruthy();
  });

  it("links to Categorías only once that screen exists", () => {
    const { unmount } = renderForm({ categories: [] });
    expect(screen.queryByRole("link", { name: "Ir a Categorías" })).toBeNull();
    unmount();
    mocks.more.push({ id: "categories", href: "/categorias", label: "Categorías" });
    renderForm({ categories: [] });
    expect(screen.getByRole("link", { name: "Ir a Categorías" }).getAttribute("href")).toBe(
      "/categorias",
    );
  });

  it("ignores the archived categories and the subcategories of an archived principal", () => {
    const archived = "2026-10-01T10:00:00Z";
    renderForm({
      categories: CATEGORIES.map((item) =>
        item.id === COMIDA.id || item.id === "cat-Combustible"
          ? { ...item, archived_at: archived }
          : item,
      ).filter((item) => item.archived_at === null),
    });
    expect(
      within(screen.getByRole("group", { name: "Categoría" }))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Transporte", "Ropa"]);
  });

  it("holds a category with a very long name in two lines and a full title", () => {
    const long = "Regalos y detalles para la familia y los amigos de siempre";
    renderForm({ categories: [category(long)] });
    const button = cell(long);
    expect(button.getAttribute("title")).toBe(long);
    expect(button.querySelector(".line-clamp-2")?.textContent).toBe(long);
  });

  it("holds the largest amount the backend takes, as the exact integer", async () => {
    const { onDone } = renderForm();
    type("Monto", "90071992547409,91");
    fireEvent.click(cell("Ropa"));
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentBody().amount_minor).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("uses the date typed after 'Otra fecha'", async () => {
    const { onDone } = renderForm();
    type("Monto", "100");
    fireEvent.click(cell("Ropa"));
    fireEvent.click(screen.getByRole("radio", { name: "Otra fecha" }));
    fireEvent.change(screen.getByLabelText("Fecha del movimiento"), {
      target: { value: "2026-09-30" },
    });
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentBody().date).toBe("2026-09-30");
  });
});

describe("what the form shows on desktop (panel)", () => {
  it("shows the label of the type, the account beside the category and 'Cancelar · Guardar gasto'", () => {
    const onCancel = vi.fn();
    renderForm({ variant: "panel", onCancel });
    const group = screen.getByRole("group", { name: "Tipo" });
    expect(within(group).getByText("Tipo").className).not.toContain("sr-only");
    const account = screen.getByLabelText("Cuenta");
    const category = screen.getByLabelText("Categoría");
    expect(account.closest(".grid")).toBe(category.closest(".grid"));
    // On desktop the account comes first, as in the canvas.
    expect(
      account.compareDocumentPosition(category) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const buttons = screen.getAllByRole("button").map((button) => button.textContent);
    expect(buttons.slice(-2)).toEqual(["Cancelar", "Guardar gasto"]);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("groups the category select by principal, itself first, with 'Otras' last", () => {
    renderForm({ variant: "panel" });
    const select = screen.getByLabelText("Categoría") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(within(select).getAllByRole("option")[0]?.textContent).toBe("Elige una");
    const groups = Array.from(select.querySelectorAll("optgroup")).map((group) => [
      group.label,
      Array.from(group.querySelectorAll("option")).map((option) => option.textContent),
    ]);
    expect(groups).toEqual([
      ["Comida", ["Comida", "Supermercado"]],
      ["Transporte", ["Transporte", "Taxi y apps", "Combustible"]],
      ["Otras", ["Ropa"]],
    ]);
  });

  it("shows the date input with 'Hoy' and 'Ayer' beside it, and no 'Otra fecha'", () => {
    renderForm({ variant: "panel" });
    expect((screen.getByLabelText("Fecha") as HTMLInputElement).value).toBe("2026-10-26");
    expect(screen.getByRole("button", { name: "Hoy" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Ayer" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("radio", { name: "Otra fecha" })).toBeNull();
  });

  it("registers an expense with the select and the 'Ayer' button", async () => {
    const { onDone } = renderForm({ variant: "panel" });
    type("Monto", "2340,50");
    type("Categoría", "cat-Taxi y apps");
    fireEvent.click(screen.getByRole("button", { name: "Ayer" }));
    save("Guardar gasto");
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentBody()).toEqual({
      type: "expense",
      account_id: "acc-itau",
      category_id: "cat-Taxi y apps",
      amount_minor: 234050,
      date: "2026-10-25",
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Registraste «Taxi y apps»");
  });

  it("shows the error of the category under the select and marks it invalid", async () => {
    renderForm({ variant: "panel" });
    type("Monto", "100");
    save();
    expect(await screen.findByText("Elige una categoría.")).toBeTruthy();
    expect(screen.getByLabelText("Categoría").getAttribute("aria-invalid")).toBe("true");
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("puts 'Desde' and 'Hacia' in one row with the swap icon between them", () => {
    renderForm({ variant: "panel" });
    pickType("Transferencia");
    const desde = screen.getByLabelText("Desde");
    const hacia = screen.getByLabelText("Hacia");
    // Each select is a field inside a column of the same row.
    const row = (select: HTMLElement) =>
      select.closest("[data-slot='field']")?.parentElement?.parentElement;
    expect(row(desde)).toBe(row(hacia));
    expect(row(desde)?.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  });

  it("keeps the button off and the note out when the space has one account only", () => {
    renderForm({ variant: "panel", accounts: [ITAU] });
    pickType("Transferencia");
    expect(
      screen.getByRole("button", { name: "Guardar transferencia" }).getAttribute("aria-disabled"),
    ).toBe("true");
    expect(screen.queryByText(/Pagar la tarjeta es una transferencia/)).toBeNull();
  });
});

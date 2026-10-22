import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountForm } from "./account-form";

// The edges are mocked: the typed browser client and the toast. What is under test is
// the form: what it shows for each type, what it sends, how a failure comes back to the fields or
// the Alert, and that it cannot create two accounts.
const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  toastSuccess: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@/lib/api/browser", () => ({ browserApi: { POST: mocks.post } }));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess } }));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  onlineManager.setOnline(true);
});

const SPACE = { id: "space-1", currency: { code: "UYU", exponent: 2 } };
const ACCOUNT = {
  id: "acc-1",
  name: "Itaú",
  type: "bank",
  closing_day: null,
  due_day: null,
  archived_at: null,
  balance_minor: 155050,
};

function created(account: unknown = ACCOUNT) {
  return { data: account, response: new Response(null, { status: 201 }) };
}

function failure(status: number, body?: unknown) {
  return { error: body, response: new Response(null, { status }) };
}

beforeEach(() => {
  mocks.post.mockReset().mockResolvedValue(created());
  mocks.toastSuccess.mockReset();
  mocks.replace.mockReset();
  vi.stubGlobal("location", { ...window.location, replace: mocks.replace });
});

function renderForm(props: Partial<Parameters<typeof AccountForm>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const onDone = vi.fn();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AccountForm space={SPACE} variant="page" onDone={onDone} {...props} />
    </QueryClientProvider>,
  );
  return { ...view, onDone, invalidate };
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function pick(name: string) {
  fireEvent.click(screen.getByRole("radio", { name }));
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
}

/** The body of the one request that was sent. */
function sentBody() {
  expect(mocks.post).toHaveBeenCalledTimes(1);
  return mocks.post.mock.calls[0]?.[1]?.body;
}

describe("what the form shows", () => {
  it("starts with a type chosen: Banco, so the type is never empty", () => {
    renderForm();
    expect((screen.getByRole("radio", { name: "Banco" }) as HTMLInputElement).checked).toBe(true);
    expect(
      screen.getAllByRole("radio").map((radio) => radio.nextElementSibling?.textContent),
    ).toEqual(["Banco", "Efectivo", "Tarjeta"]);
    expect(screen.getByRole("group", { name: "Tipo" })).toBeTruthy();
  });

  it("asks for a bank's name and balance, with the canvas' example and help", () => {
    renderForm();
    expect(screen.getByLabelText("Nombre").getAttribute("placeholder")).toBe("Ej.: Itaú");
    const balance = screen.getByLabelText("Saldo actual");
    expect(balance.getAttribute("placeholder")).toBe("0,00");
    expect(screen.getByText(/Lo que tienes hoy en esta cuenta/).textContent).toBe(
      "Lo que tienes hoy en esta cuenta. Se registra como ajuste: no cuenta como ingreso.",
    );
    expect(screen.queryByLabelText("Día de cierre")).toBeNull();
  });

  it("changes the example and the help for cash", () => {
    renderForm();
    pick("Efectivo");
    expect(screen.getByLabelText("Nombre").getAttribute("placeholder")).toBe("Ej.: Billetera");
    expect(screen.getByLabelText("Saldo actual")).toBeTruthy();
    expect(screen.getByText(/Lo que tienes hoy en efectivo/).textContent).toBe(
      "Lo que tienes hoy en efectivo. Se registra como ajuste: no cuenta como ingreso.",
    );
    expect(screen.queryByLabelText("Día de cierre")).toBeNull();
  });

  it("asks for a card's debt in the debt color, and for its two days with nothing preselected", () => {
    renderForm();
    pick("Tarjeta");
    expect(screen.getByLabelText("Nombre").getAttribute("placeholder")).toBe("Ej.: Visa Itaú");
    expect(screen.queryByLabelText("Saldo actual")).toBeNull();
    expect(screen.getByLabelText("Deuda actual").className).toContain("text-debt");
    expect(screen.getByText(/Lo que debes hoy en la tarjeta/).textContent).toBe(
      "Lo que debes hoy en la tarjeta. Se registra como ajuste: no cuenta como gasto.",
    );

    const closing = screen.getByLabelText("Día de cierre") as HTMLSelectElement;
    const due = screen.getByLabelText("Día de vencimiento") as HTMLSelectElement;
    expect(closing.value).toBe("");
    expect(due.value).toBe("");
    expect(within(closing).getAllByRole("option")).toHaveLength(32); // "Elige" + 1 to 31
    expect(within(closing).getAllByRole("option")[0]?.textContent).toBe("Elige");
    expect(screen.getByText("Con estos días Kanza calcula cuánto pagar cada mes.")).toBeTruthy();
    expect(closing.getAttribute("aria-describedby")).toContain("account-days-help");
  });

  it("puts the symbol of the space's currency in front of the amount, never a fixed '$'", () => {
    const { container } = renderForm({
      space: { id: "s", currency: { code: "USD", exponent: 2 } },
    });
    expect(container.querySelector("[aria-hidden='true']")?.textContent).toBe("US$");
  });

  it("follows the exponent of the currency in the placeholder", () => {
    renderForm({ space: { id: "s", currency: { code: "CLP", exponent: 0 } } });
    expect(screen.getByLabelText("Saldo actual").getAttribute("placeholder")).toBe("0");
  });

  it("has noValidate: the messages are the schema's, in Spanish", () => {
    const { container } = renderForm();
    expect(container.querySelector("form")?.noValidate).toBe(true);
  });
});

describe("the two containers", () => {
  it("page: one full-width 'Crear cuenta' at the end and no 'Cancelar'", () => {
    renderForm({ variant: "page" });
    expect(screen.getAllByRole("button", { name: "Crear cuenta" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
    expect(document.querySelector("[data-slot='sheet-footer']")).toBeNull();
  });

  it("panel: the fields scroll in the body and 'Cancelar · Crear cuenta' sit in the footer", () => {
    const onCancel = vi.fn();
    renderForm({ variant: "panel", onCancel });
    const body = document.querySelector("[data-slot='sheet-body']") as HTMLElement;
    const footer = document.querySelector("[data-slot='sheet-footer']") as HTMLElement;
    expect(within(body).getByLabelText("Nombre")).toBeTruthy();
    expect(
      Array.from(footer.querySelectorAll("button")).map((button) => button.textContent),
    ).toEqual(["Cancelar", "Crear cuenta"]);
    // One form around both, so the footer's button submits what the body holds.
    expect(body.closest("form")).toBe(footer.closest("form"));
    fireEvent.click(within(footer).getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("panel: the submit button of the footer sends the form", async () => {
    renderForm({ variant: "panel" });
    type("Nombre", "Itaú");
    submit();
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
  });
});

describe("what it sends", () => {
  it("a bank: the type, the name and the balance as an integer of the minor unit", async () => {
    renderForm();
    type("Nombre", "  Itaú  ");
    type("Saldo actual", "1550,50");
    submit();
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    expect(mocks.post).toHaveBeenCalledWith("/spaces/{space_id}/accounts", {
      params: { path: { space_id: "space-1" } },
      body: { type: "bank", name: "Itaú", initial_balance_minor: 155050 },
    });
  });

  it("leaves the balance out when it is empty or zero", async () => {
    renderForm();
    type("Nombre", "Billetera");
    pick("Efectivo");
    submit();
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    expect(sentBody()).toEqual({ type: "cash", name: "Billetera" });
  });

  it("a card: the debt written positive goes negative, with both days as numbers", async () => {
    renderForm();
    type("Nombre", "Visa Itaú");
    pick("Tarjeta");
    type("Deuda actual", "24120");
    type("Día de cierre", "5");
    type("Día de vencimiento", "12");
    submit();
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    expect(sentBody()).toEqual({
      type: "credit_card",
      name: "Visa Itaú",
      initial_balance_minor: -2412000,
      closing_day: 5,
      due_day: 12,
    });
  });

  it("drops the days if the person filled them on the card tab and came back to a bank", async () => {
    renderForm();
    type("Nombre", "Itaú");
    pick("Tarjeta");
    type("Día de cierre", "5");
    type("Día de vencimiento", "12");
    pick("Banco");
    submit();
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    expect(sentBody()).toEqual({ type: "bank", name: "Itaú" });
  });

  it("uses the exponent of the space: whole units for a currency without decimals", async () => {
    renderForm({ space: { id: "s", currency: { code: "CLP", exponent: 0 } } });
    type("Nombre", "Banco Estado");
    type("Saldo actual", "15000");
    submit();
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    expect(sentBody()).toEqual({
      type: "bank",
      name: "Banco Estado",
      initial_balance_minor: 15000,
    });
  });

  it("accepts an overdraft on a bank with a leading minus", async () => {
    renderForm();
    type("Nombre", "Itaú");
    type("Saldo actual", "-250,75");
    submit();
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    expect(sentBody()).toMatchObject({ initial_balance_minor: -25075 });
  });
});

describe("what it refuses before sending", () => {
  it("shows every problem at once, in Spanish, linked to its field, and sends nothing", async () => {
    renderForm();
    pick("Tarjeta");
    type("Deuda actual", "1,505");
    submit();
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(4));
    const alerts = screen.getAllByRole("alert").map((alert) => alert.textContent);
    expect(alerts).toContain("Escribe un nombre.");
    expect(alerts).toContain("Usa como máximo 2 decimales.");
    expect(alerts.filter((text) => text === "Elige un día del 1 al 31.")).toHaveLength(2);
    expect(screen.getByLabelText("Nombre").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Día de cierre").getAttribute("aria-invalid")).toBe("true");
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("moves the focus to the first invalid field", async () => {
    renderForm();
    submit();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Nombre")));
  });

  it("counts the 80 characters of the name by code point: 80 emojis go, 81 do not", async () => {
    renderForm();
    type("Nombre", "😀".repeat(81));
    submit();
    expect(await screen.findByText("Usa como máximo 80 caracteres.")).toBeTruthy();
    expect(mocks.post).not.toHaveBeenCalled();

    type("Nombre", "😀".repeat(80));
    submit();
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
  });

  it("clears an error as soon as the field is corrected", async () => {
    renderForm();
    submit();
    await screen.findByText("Escribe un nombre.");
    type("Nombre", "Itaú");
    await waitFor(() => expect(screen.queryByText("Escribe un nombre.")).toBeNull());
  });
});

describe("when the backend answers with a failure", () => {
  const validation = (type: string, loc: string[]) =>
    failure(422, { detail: [{ type, loc: ["body", ...loc], msg: "English message" }] });

  async function submitValid() {
    type("Nombre", "Itaú");
    submit();
    await waitFor(() => expect(mocks.post).toHaveBeenCalled());
  }

  it("marks the fields a 422 names, with the backend's fields mapped to the form's", async () => {
    mocks.post.mockResolvedValue(
      failure(422, {
        detail: [
          { type: "string_too_long", loc: ["body", "name"], msg: "x" },
          { type: "greater_than", loc: ["body", "initial_balance_minor"], msg: "x" },
          { type: "card_day_required", loc: ["body", "closing_day"], msg: "x" },
          { type: "card_day_required", loc: ["body", "due_day"], msg: "x" },
        ],
      }),
    );
    renderForm();
    pick("Tarjeta");
    type("Día de cierre", "5");
    type("Día de vencimiento", "12");
    await submitValid();

    expect(await screen.findByText("Es demasiado largo.")).toBeTruthy();
    expect(screen.getByLabelText("Nombre").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Deuda actual").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("El valor es demasiado bajo.")).toBeTruthy();
    expect(screen.getAllByText("Elige un día del 1 al 31.")).toHaveLength(2);
    // Every problem was placed on a field: no extra Alert.
    expect(
      screen
        .getAllByRole("alert")
        .every((alert) => alert.getAttribute("data-slot") === "field-error"),
    ).toBe(true);
    expect(screen.queryByText(/English message/)).toBeNull();
    // And the person can correct and try again.
    expect(
      screen.getByRole("button", { name: "Crear cuenta" }).getAttribute("aria-busy"),
    ).toBeNull();
  });

  it("moves the focus to the first field the backend marked", async () => {
    mocks.post.mockResolvedValue(validation("string_too_long", ["name"]));
    renderForm();
    await submitValid();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Nombre")));
  });

  it("shows an Alert for a 422 on something the form does not have", async () => {
    mocks.post.mockResolvedValue(validation("timezone_invalid", ["timezone"]));
    renderForm();
    await submitValid();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("No pudimos detectar tu zona horaria");
    expect(alert.textContent).not.toContain("timezone_invalid");
  });

  it("shows an Alert, in Spanish, for a 404 (the space is gone)", async () => {
    mocks.post.mockResolvedValue(
      failure(404, { code: "space_not_found", detail: "Space not found" }),
    );
    renderForm();
    await submitValid();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("No encontramos ese espacio");
    expect(alert.textContent).not.toContain("Space not found");
    expect(alert.textContent).not.toContain("space_not_found");
  });

  it("shows a connection Alert when the request does not reach the backend", async () => {
    mocks.post.mockRejectedValue(new TypeError("Failed to fetch"));
    renderForm();
    await submitValid();
    expect((await screen.findByRole("alert")).textContent).toContain("No pudimos conectar");
  });

  it("goes to /login on a 401: the session ended", async () => {
    mocks.post.mockResolvedValue(
      failure(401, { code: "invalid_session", detail: "Session expired" }),
    );
    renderForm();
    await submitValid();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears the Alert when the person tries again", async () => {
    mocks.post.mockResolvedValueOnce(failure(500, { code: "internal_error", detail: "x" }));
    renderForm();
    await submitValid();
    await screen.findByText("Algo salió mal de nuestro lado");
    submit();
    await waitFor(() => expect(screen.queryByText("Algo salió mal de nuestro lado")).toBeNull());
  });

  it("does not leave the form, show the toast or refresh on a failure", async () => {
    mocks.post.mockResolvedValue(failure(500, { code: "internal_error", detail: "x" }));
    const { onDone } = renderForm();
    await submitValid();
    await screen.findByRole("alert");
    expect(onDone).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("when the account is created", () => {
  it("invalidates the space's queries, says so and hands over", async () => {
    const { onDone, invalidate } = renderForm();
    type("Nombre", "Itaú");
    submit();
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["spaces", "space-1"] });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Creaste «Itaú»");
    expect(onDone).toHaveBeenCalledWith(ACCOUNT);
  });

  it("names the account as the backend returns it", async () => {
    mocks.post.mockResolvedValue(created({ ...ACCOUNT, name: "Itaú Black" }));
    renderForm();
    type("Nombre", "  Itaú Black ");
    submit();
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("Creaste «Itaú Black»"));
  });
});

describe("one account at a time", () => {
  it("sends a single request however many times it is submitted while it runs", async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.post.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderForm();
    type("Nombre", "Itaú");
    const button = screen.getByRole("button", { name: "Crear cuenta" });
    submit();
    await waitFor(() => expect(button.getAttribute("aria-busy")).toBe("true"));
    submit();
    fireEvent.submit(button.closest("form") as HTMLFormElement);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    finish(created());
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledTimes(1));
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it("stays busy after it worked, until the container has left the form", async () => {
    const { onDone } = renderForm();
    type("Nombre", "Itaú");
    submit();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Crear cuenta" }).getAttribute("aria-busy")).toBe(
      "true",
    );
    submit();
    fireEvent.submit(
      screen.getByRole("button", { name: "Crear cuenta" }).closest("form") as HTMLFormElement,
    );
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it("can be sent again after a failure", async () => {
    mocks.post.mockResolvedValueOnce(failure(500, { code: "internal_error", detail: "x" }));
    renderForm();
    type("Nombre", "Itaú");
    submit();
    await screen.findByRole("alert");
    submit();
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
  });
});

describe("without a connection", () => {
  it("says so while the request waits, in the words of any network failure, and keeps the button busy", async () => {
    onlineManager.setOnline(false);
    renderForm();
    type("Nombre", "Itaú");
    submit();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("No pudimos conectar");
    expect(alert.textContent).toContain("Revisa tu conexión");
    // TanStack Query paused it: nothing went out, and the button says it is working.
    expect(mocks.post).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Crear cuenta" }).getAttribute("aria-busy")).toBe(
      "true",
    );
  });

  it("sends the request by itself when the connection returns, and the notice goes", async () => {
    onlineManager.setOnline(false);
    const { onDone } = renderForm();
    type("Nombre", "Itaú");
    submit();
    await screen.findByRole("alert");

    onlineManager.setOnline(true);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not send a second request if it is submitted again while it waits", async () => {
    onlineManager.setOnline(false);
    renderForm();
    type("Nombre", "Itaú");
    submit();
    await screen.findByRole("alert");
    submit();
    fireEvent.submit(
      screen.getByRole("button", { name: "Crear cuenta" }).closest("form") as HTMLFormElement,
    );
    onlineManager.setOnline(true);
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledTimes(1));
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it("shows no notice while there is a connection", async () => {
    renderForm();
    type("Nombre", "Itaú");
    submit();
    await waitFor(() => expect(mocks.post).toHaveBeenCalled());
    expect(screen.queryByText("No pudimos conectar")).toBeNull();
  });
});

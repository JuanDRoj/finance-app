import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import { ReconcileForm } from "./reconcile-form";

const mocks = vi.hoisted(() => ({ post: vi.fn(), toastSuccess: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess } }));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const API = { POST: mocks.post } as unknown as ApiClient;
const SPACE = { id: "space-1", currency: { code: "UYU", exponent: 2 } };
const BANK: AccountWithBalance = {
  id: "a1",
  name: "Itaú",
  type: "bank",
  closing_day: null,
  due_day: null,
  archived_at: null,
  balance_minor: 8425000,
};
const CARD: AccountWithBalance = {
  ...BANK,
  id: "a3",
  name: "Visa Itaú",
  type: "credit_card",
  closing_day: 5,
  due_day: 12,
  balance_minor: -2412000,
};

const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) });
const failure = (status: number, body?: unknown) => ({
  error: body,
  response: new Response(null, { status }),
});

beforeEach(() => {
  mocks.post.mockReset().mockResolvedValue(ok(BANK));
  mocks.toastSuccess.mockReset();
});

function renderForm(account = BANK, variant: "panel" | "sheet" = "panel") {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const onDone = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ReconcileForm account={account} space={SPACE} variant={variant} api={API} onDone={onDone} />
    </QueryClientProvider>,
  );
  return { onDone, invalidate };
}

const label = (account = BANK) =>
  ({
    bank: "Saldo real en tu banco",
    cash: "Efectivo que tienes",
    credit_card: "Deuda real de la tarjeta",
  })[account.type];
const typeReal = (value: string, account = BANK) =>
  fireEvent.change(screen.getByLabelText(label(account)), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Cuadrar saldo" }));
const preview = () => document.querySelector("[aria-live='polite']")?.textContent;

describe("what the form shows", () => {
  it("shows the account, the balance in Kanza and an empty field with the hint of its type", () => {
    renderForm();
    expect(screen.getByText("Itaú")).toBeTruthy();
    expect(screen.getByText("Saldo en Kanza")).toBeTruthy();
    expect(screen.getByText("$ 84.250,00")).toBeTruthy();
    expect((screen.getByLabelText("Saldo real en tu banco") as HTMLInputElement).value).toBe("");
    expect(preview()).toBe("Escribe el saldo que ves en tu banco.");
  });

  it("calls the field and the balance of a card 'Deuda', in the debt color", () => {
    renderForm(CARD);
    expect(screen.getByText("Deuda en Kanza")).toBeTruthy();
    expect(screen.getByText("$ 24.120,00").className).toContain("text-debt");
    expect(preview()).toBe("Escribe el saldo que dice el resumen de tu tarjeta.");
  });

  it("points the field at the live preview, and keeps the currency in its description", () => {
    renderForm();
    const field = screen.getByLabelText("Saldo real en tu banco");
    const ids = (field.getAttribute("aria-describedby") ?? "").split(" ");
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toContain(preview());
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toContain(
      "Moneda: Peso uruguayo · UYU",
    );
  });

  it("previews the adjustment as you type, with the signs of the canvas", () => {
    renderForm();
    typeReal("85000");
    expect(preview()).toBe(
      "Se registrará un ajuste de +$\u00A0750,00. No cuenta como ingreso ni gasto.",
    );
    typeReal("84000");
    expect(preview()).toBe(
      "Se registrará un ajuste de −$\u00A0250,00. No cuenta como ingreso ni gasto.",
    );
    typeReal("84250");
    expect(preview()).toBe("El saldo ya coincide: no se registra ningún ajuste.");
  });
});

describe("matching the balance", () => {
  it("sends the real balance in the minor unit, invalidates, says 'Cuadraste' and reports it", async () => {
    const { onDone, invalidate } = renderForm();
    typeReal("85000,50");
    submit();
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(mocks.post).toHaveBeenCalledWith("/spaces/{space_id}/accounts/{account_id}/reconcile", {
      params: { path: { space_id: "space-1", account_id: "a1" } },
      body: { balance_minor: 8500050 },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["spaces", "space-1"] });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Cuadraste «Itaú»");
  });

  it("sends a card's real debt, written positive, as a negative balance", async () => {
    const { onDone } = renderForm(CARD);
    typeReal("25000", CARD);
    expect(preview()).toBe("Tu deuda sube $\u00A0880,00. No cuenta como ingreso ni gasto.");
    submit();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.post.mock.calls[0]![1].body).toEqual({ balance_minor: -2500000 });
  });

  it("accepts zero", async () => {
    const { onDone } = renderForm();
    typeReal("0");
    submit();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.post.mock.calls[0]![1].body).toEqual({ balance_minor: 0 });
  });

  it("makes no request when it already matches", async () => {
    const { onDone } = renderForm();
    typeReal("84250");
    submit();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("asks for an amount when the field is empty, and says what is wrong with a bad one", () => {
    renderForm();
    submit();
    expect(screen.getByText("Escribe un monto.")).toBeTruthy();
    typeReal("12,345");
    submit();
    expect(screen.getByText("Usa como máximo 2 decimales.", { selector: "p, span" })).toBeTruthy();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("refuses a minus on a card's debt", () => {
    renderForm(CARD);
    typeReal("-5", CARD);
    submit();
    expect(screen.getAllByText("Escribe la deuda en positivo, sin signo.").length).toBeGreaterThan(
      0,
    );
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("explains an archived account in Spanish and does not close", async () => {
    mocks.post.mockResolvedValue(failure(409, { code: "account_archived", detail: "x" }));
    const { onDone } = renderForm();
    typeReal("1");
    submit();
    expect(await screen.findByText("Esa cuenta está archivada")).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("holds the biggest amounts", () => {
    renderForm({ ...BANK, balance_minor: 9007199254740991 });
    expect(screen.getByText("$ 90.071.992.547.409,91").className).toContain("break-all");
    typeReal("-90071992547409,91");
    expect(preview()).toContain("−$\u00A0180.143.985.094.819,82");
  });

  it("has the same button in the bottom sheet", () => {
    renderForm(BANK, "sheet");
    expect(screen.getByRole("button", { name: "Cuadrar saldo" }).className).toContain("w-full");
  });
});

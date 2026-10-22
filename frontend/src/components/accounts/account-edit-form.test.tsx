import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import { AccountEditForm } from "./account-edit-form";

// The edges are mocked: the scripted API client, the router, the width and the toast. The form, the
// "Más acciones" group, the alert of archiving and the hook that archives are the real ones.
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  desktop: true,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/components/use-is-desktop", () => ({
  DESKTOP_MEDIA_QUERY: "(min-width: 64rem)",
  useIsDesktop: () => mocks.desktop,
}));
vi.mock("sonner", () => ({
  toast: Object.assign(mocks.toast, { success: mocks.toastSuccess, error: mocks.toastError }),
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const SPACE = { id: "space-1", currency: { code: "UYU", exponent: 2 } };
const API = { GET: mocks.get, PATCH: mocks.patch, POST: mocks.post } as unknown as ApiClient;

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

function ok(data: unknown) {
  return { data, response: new Response(null, { status: 200 }) };
}
function failure(status: number, body?: unknown) {
  return { error: body, response: new Response(null, { status }) };
}

beforeEach(() => {
  mocks.get.mockReset();
  mocks.patch
    .mockReset()
    .mockImplementation(async (_p: string, init: { body: object }) =>
      ok({ ...BANK, ...init.body }),
    );
  mocks.post.mockReset().mockResolvedValue(ok({ ...BANK, archived_at: "2026-10-22T10:00:00Z" }));
  mocks.refresh.mockReset();
  mocks.toast.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  mocks.desktop = true;
});

function renderForm(account = BANK, props: Partial<Parameters<typeof AccountEditForm>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const handlers = {
    onDone: vi.fn(),
    onArchived: vi.fn(),
    onReconcile: vi.fn(),
    onCancel: vi.fn(),
  };
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AccountEditForm
        account={account}
        space={SPACE}
        variant="panel"
        api={API}
        {...handlers}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...view, ...handlers, invalidate };
}

const save = () => fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
const rename = (value: string) =>
  fireEvent.change(screen.getByLabelText("Nombre"), { target: { value } });

describe("what the form shows", () => {
  it("shows the type fixed with its note, and the name of the account", () => {
    renderForm();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText("Banco")).toBeTruthy();
    expect(screen.getByText("El tipo no se cambia después de crear la cuenta.")).toBeTruthy();
    expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe("Itaú");
    expect(screen.queryByLabelText(/Saldo|Deuda actual/)).toBeNull();
    expect(screen.queryByLabelText("Día de cierre")).toBeNull();
  });

  it("starts a card with its own days, never 'Elige'", () => {
    renderForm(CARD);
    expect((screen.getByLabelText("Día de cierre") as HTMLSelectElement).value).toBe("5");
    expect((screen.getByLabelText("Día de vencimiento") as HTMLSelectElement).value).toBe("12");
    expect(screen.queryByRole("option", { name: "Elige" })).toBeNull();
    expect(screen.getByText("Con estos días Kanza calcula cuánto pagar cada mes.")).toBeTruthy();
  });

  it("has 'Más acciones' with Cuadrar saldo and Archivar cuenta, naming the zero in the space's currency", () => {
    renderForm();
    const group = within(screen.getByRole("region", { name: "Más acciones" }));
    expect(group.getByText("Iguálalo con lo que dice tu banco")).toBeTruthy();
    expect(group.getByRole("button", { name: /Archivar cuenta/ }).textContent).toContain(
      "Solo con saldo en $\u00A00,00",
    );
  });

  it("says the help of a card and of cash in their own words", () => {
    renderForm(CARD);
    expect(screen.getByText("Iguálala con el resumen de tu tarjeta")).toBeTruthy();
    cleanup();
    renderForm({ ...BANK, type: "cash" });
    expect(screen.getByText("Iguálalo con el efectivo que tienes")).toBeTruthy();
  });
});

describe("saving", () => {
  it("sends only what changed, invalidates the space, says so and reports it", async () => {
    const { onDone, invalidate } = renderForm();
    rename("  Santander ");
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    expect(mocks.patch).toHaveBeenCalledWith("/spaces/{space_id}/accounts/{account_id}", {
      params: { path: { space_id: "space-1", account_id: "a1" } },
      body: { name: "Santander" },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["spaces", "space-1"] });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Guardaste «Santander»");
  });

  it("sends a card's changed day alone", async () => {
    const { onDone } = renderForm(CARD);
    fireEvent.change(screen.getByLabelText("Día de vencimiento"), {
      target: { value: "20" },
    });
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.patch.mock.calls[0]![1].body).toEqual({ due_day: 20 });
  });

  it("makes no request when nothing changed", async () => {
    const { onDone } = renderForm();
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(false));
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("asks for a name and refuses one past 80 characters, without a request", async () => {
    renderForm();
    rename("   ");
    save();
    expect(await screen.findByText("Escribe un nombre.")).toBeTruthy();
    rename("a".repeat(81));
    save();
    expect(await screen.findByText("Usa como máximo 80 caracteres.")).toBeTruthy();
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it("marks the field a 422 names", async () => {
    mocks.patch.mockResolvedValue(
      failure(422, { detail: [{ type: "string_too_long", loc: ["body", "name"], msg: "x" }] }),
    );
    renderForm();
    rename("Otro");
    save();
    expect(await screen.findByText("Es demasiado largo.")).toBeTruthy();
  });

  it("explains any other failure in Spanish", async () => {
    mocks.patch.mockResolvedValue(failure(404, { code: "account_not_found", detail: "x" }));
    renderForm();
    rename("Otro");
    save();
    expect(await screen.findByText("No encontramos esa cuenta")).toBeTruthy();
  });

  it("Cancelar calls onCancel", () => {
    const { onCancel } = renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("Cuadrar saldo from 'Más acciones'", () => {
  it("asks the container to show the reconcile view", () => {
    const { onReconcile } = renderForm();
    fireEvent.click(screen.getByRole("button", { name: /Cuadrar saldo/ }));
    expect(onReconcile).toHaveBeenCalledTimes(1);
  });
});

describe("archiving", () => {
  const archive = () => fireEvent.click(screen.getByRole("button", { name: /Archivar cuenta/ }));

  it("archives without asking, shows 'Archivaste' with Deshacer and reports it", async () => {
    const { onArchived, invalidate } = renderForm();
    archive();
    await waitFor(() => expect(onArchived).toHaveBeenCalledTimes(1));
    expect(mocks.post).toHaveBeenCalledWith("/spaces/{space_id}/accounts/{account_id}/archive", {
      params: { path: { space_id: "space-1", account_id: "a1" } },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["spaces", "space-1"] });
    const [text, options] = mocks.toastSuccess.mock.calls[0]!;
    expect(text).toBe("Archivaste «Itaú»");
    expect(options.action.label).toBe("Deshacer");
  });

  it("Deshacer unarchives, invalidates and refreshes the server data", async () => {
    const { onArchived, unmount } = renderForm();
    archive();
    await waitFor(() => expect(onArchived).toHaveBeenCalled());
    // The panel is gone by the time the person taps Deshacer: the toast has to work on its own.
    unmount();
    mocks.post.mockClear().mockResolvedValue(ok({ ...BANK, archived_at: null }));
    mocks.toastSuccess.mock.calls[0]![1].action.onClick();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.post).toHaveBeenCalledWith("/spaces/{space_id}/accounts/{account_id}/unarchive", {
      params: { path: { space_id: "space-1", account_id: "a1" } },
    });
  });

  it("tells a failed Deshacer in a toast", async () => {
    const { onArchived, unmount } = renderForm();
    archive();
    await waitFor(() => expect(onArchived).toHaveBeenCalled());
    unmount();
    mocks.post.mockResolvedValue(failure(404, { code: "account_not_found", detail: "x" }));
    mocks.toastSuccess.mock.calls[0]![1].action.onClick();
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("No encontramos esa cuenta", expect.anything()),
    );
  });

  describe("when the balance is not zero (409 account_has_balance)", () => {
    beforeEach(() => {
      mocks.post.mockResolvedValue(
        failure(409, { code: "account_has_balance", detail: "Balance is not zero" }),
      );
      mocks.get.mockResolvedValue(ok(BANK));
    });

    it("opens the alertdialog with today's balance, reading the account again, and does not leave", async () => {
      const { onArchived } = renderForm();
      archive();
      const dialog = await screen.findByRole("alertdialog");
      expect(mocks.get).toHaveBeenCalledWith("/spaces/{space_id}/accounts/{account_id}", {
        params: { path: { space_id: "space-1", account_id: "a1" } },
      });
      expect(
        within(dialog).getByRole("heading", { name: "Todavía no puedes archivar Itaú" }),
      ).toBeTruthy();
      expect(dialog.textContent).toContain(
        "Para archivar una cuenta, su saldo tiene que ser $\u00A00,00. Hoy tiene $\u00A084.250,00.",
      );
      expect(dialog.textContent).toContain(
        "Pasa el dinero a otra cuenta con una transferencia o, si ya no la usas, cuadra su saldo en $\u00A00,00.",
      );
      expect(onArchived).not.toHaveBeenCalled();
    });

    it("invalidates the accounts of the space and refreshes the server data, so the reconcile view starts from this balance", async () => {
      const { invalidate } = renderForm();
      archive();
      await screen.findByRole("alertdialog");
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["spaces", "space-1"] });
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
    });

    it("does not say a card paid in excess owes: it has a balance in its favor", async () => {
      const overpaid = { ...CARD, balance_minor: 1000 };
      mocks.get.mockResolvedValue(ok(overpaid));
      renderForm(overpaid);
      archive();
      const dialog = await screen.findByRole("alertdialog");
      expect(dialog.textContent).toContain("Hoy tienes $\u00A010,00 a favor en esta tarjeta.");
      expect(dialog.textContent).not.toContain("debes");
      expect(dialog.textContent).not.toContain("\u2212");
      expect(dialog.textContent).toContain(
        "Usa ese saldo en tus compras o, si ya no la usas, cuadra su saldo en $\u00A00,00.",
      );
    });

    it("says the debt of a card in words", async () => {
      mocks.get.mockResolvedValue(ok(CARD));
      renderForm(CARD);
      archive();
      const dialog = await screen.findByRole("alertdialog");
      expect(dialog.textContent).toContain("Hoy debes $\u00A024.120,00 en esta tarjeta.");
      expect(dialog.textContent).toContain(
        "Págala con una transferencia o, si ya no la usas, cuadra su saldo en $\u00A00,00.",
      );
    });

    it("uses the account it had if reading it again fails", async () => {
      mocks.get.mockResolvedValue(failure(500));
      renderForm();
      archive();
      expect((await screen.findByRole("alertdialog")).textContent).toContain("$\u00A084.250,00");
    });

    it("puts 'Entendido' before 'Cuadrar saldo', and Entendido closes it", async () => {
      renderForm();
      archive();
      const dialog = await screen.findByRole("alertdialog");
      const buttons = within(dialog).getAllByRole("button");
      expect(buttons.map((button) => button.textContent)).toEqual(["Entendido", "Cuadrar saldo"]);
      fireEvent.click(buttons[0]!);
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    });

    it("'Cuadrar saldo' of the alert closes it and shows the reconcile view", async () => {
      const { onReconcile } = renderForm();
      archive();
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Cuadrar saldo" }));
      expect(onReconcile).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    });

    it("is a bottom sheet on a phone", async () => {
      mocks.desktop = false;
      renderForm();
      archive();
      const dialog = await screen.findByRole("alertdialog");
      expect(dialog.getAttribute("data-placement")).toBe("bottom");
    });

    it("is a centered card of 460 px from 1024 px", async () => {
      renderForm();
      archive();
      const dialog = await screen.findByRole("alertdialog");
      expect(dialog.getAttribute("data-placement")).toBe("center");
      expect(dialog.className).toContain("w-115");
    });
  });

  it("explains another failure of archiving in the form", async () => {
    mocks.post.mockResolvedValue(failure(500, { code: "internal_error", detail: "x" }));
    renderForm();
    archive();
    expect(await screen.findByText("Algo salió mal de nuestro lado")).toBeTruthy();
  });
});

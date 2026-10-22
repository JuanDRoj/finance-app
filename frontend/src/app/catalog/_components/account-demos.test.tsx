import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountEditDemo } from "./account-demos";

// The demo runs the real edit form, the alert, the reconcile view and the panel against a scripted
// client. This keeps the script honest: if the components change the calls they make, it fails here.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/components/use-is-desktop", () => ({
  DESKTOP_MEDIA_QUERY: "(min-width: 64rem)",
  useIsDesktop: () => false,
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

const choose = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("AccountEditDemo", () => {
  it("saves a rename and tells the container", async () => {
    render(<AccountEditDemo instant />);
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Santander" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("Se guardaron los cambios.")).toBeTruthy();
  });

  it("opens the alert of archiving for an account with a balance", async () => {
    render(<AccountEditDemo instant />);
    fireEvent.click(screen.getByRole("button", { name: /Archivar cuenta/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Todavía no puedes archivar Itaú")).toBeTruthy();
  });

  it("archives an account at zero", async () => {
    render(<AccountEditDemo instant />);
    choose("Qué cuenta", "empty");
    fireEvent.click(screen.getByRole("button", { name: /Archivar cuenta/ }));
    expect(await screen.findByText(/La cuenta se archivó/)).toBeTruthy();
  });

  it("marks the name with the 422 outcome", async () => {
    render(<AccountEditDemo instant />);
    choose("Qué responde el servidor al guardar, archivar o cuadrar", "fields");
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Otro" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("Es demasiado largo.")).toBeTruthy();
  });

  it("opens the side panel on Cuadrar saldo and the bottom sheet from 'Más acciones'", async () => {
    render(<AccountEditDemo instant />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir el panel «Cuadrar saldo»" }));
    const panel = await screen.findByRole("dialog", { name: "Cuadrar saldo" });
    expect(await within(panel).findByLabelText("Saldo real en tu banco")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Cuadrar saldo" })).toBeNull());
    fireEvent.click(
      within(screen.getByRole("region", { name: "Más acciones" })).getByRole("button", {
        name: /Cuadrar saldo/,
      }),
    );
    expect(await screen.findByRole("dialog", { name: "Cuadrar saldo" })).toBeTruthy();
  });
});

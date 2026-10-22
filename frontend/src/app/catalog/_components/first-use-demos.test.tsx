import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountFormDemo, CurrencyDemo } from "./first-use-demos";

// The catalog's demos run the real form and the real card against a scripted client. This keeps the
// script honest: if the components change the calls they make, the demo stops answering and fails here.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/components/use-is-desktop", () => ({
  DESKTOP_MEDIA_QUERY: "(min-width: 64rem)",
  useIsDesktop: () => false,
}));

// The demos run in `instant` mode: no latency in the scripted server and no wait before the retry the
// picker asks for. Otherwise a test would depend on a real second (the retry's wait, TanStack Query's
// default) against the one-second timeout of `findBy`, and fail whenever the machine is busy.

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

function choose(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("AccountFormDemo", () => {
  const OUTCOME = "Qué responde el servidor al crear";

  it("creates the account and hands it to the container, then the form stays busy", async () => {
    render(<AccountFormDemo instant />);
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Itaú" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await screen.findByText("El contenedor recibió la cuenta «Itaú».")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Crear cuenta" }).getAttribute("aria-busy")).toBe(
      "true",
    );
    // And can start over.
    fireEvent.click(screen.getByRole("button", { name: "Empezar de nuevo" }));
    expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText(/El contenedor recibió/)).toBeNull();
  });

  it.each([
    ["server", "Algo salió mal de nuestro lado"],
    ["offline", "No pudimos conectar"],
  ])("shows the Alert of the %s outcome", async (outcome, text) => {
    render(<AccountFormDemo instant />);
    choose(OUTCOME, outcome);
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Itaú" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect((await screen.findByRole("alert")).textContent).toContain(text);
  });

  it("marks the fields of a 422", async () => {
    render(<AccountFormDemo instant />);
    choose(OUTCOME, "fields");
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Itaú" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await screen.findByText("Es demasiado largo.")).toBeTruthy();
    expect(screen.getByLabelText("Saldo actual").getAttribute("aria-invalid")).toBe("true");
  });

  it("stays loading when the server never answers", async () => {
    render(<AccountFormDemo instant />);
    choose(OUTCOME, "never");
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Itaú" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Crear cuenta" }).getAttribute("aria-busy")).toBe(
        "true",
      ),
    );
  });

  it("opens the panel with the same server", async () => {
    render(<AccountFormDemo instant />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir el panel «Nueva cuenta»" }));
    expect(await screen.findByRole("dialog", { name: "Nueva cuenta" })).toBeTruthy();
  });
});

describe("CurrencyDemo", () => {
  const OUTCOME = "Qué pasa al abrir «Cambiar» y al usar la moneda";

  async function openPicker() {
    fireEvent.click(screen.getByRole("button", { name: "Cambiar" }));
    return screen.findByRole("dialog", { name: "Moneda de tu espacio" });
  }

  it("lists the currencies in the order of the app", async () => {
    render(<CurrencyDemo instant />);
    await openPicker();
    const radios = await screen.findAllByRole("radio");
    expect(radios.map((radio) => (radio as HTMLInputElement).value)).toEqual([
      "UYU",
      "COP",
      "USD",
      "ARS",
      "BRL",
      "EUR",
    ]);
  });

  it("shows the list failing, and the list stuck loading", async () => {
    const { unmount } = render(<CurrencyDemo instant />);
    choose(OUTCOME, "list-error");
    await openPicker();
    expect((await screen.findByRole("alert")).textContent).toContain("Algo salió mal");
    unmount();

    render(<CurrencyDemo instant />);
    choose(OUTCOME, "list-loading");
    const dialog = await openPicker();
    expect(dialog.querySelectorAll("[data-slot='skeleton']")).toHaveLength(6);
  });

  it("shows the 409 when the currency is used", async () => {
    render(<CurrencyDemo instant />);
    choose(OUTCOME, "locked");
    await openPicker();
    fireEvent.click(await screen.findByRole("radio", { name: /Euro/ }));
    fireEvent.click(screen.getByRole("button", { name: "Usar esta moneda" }));
    expect(await screen.findByText("Ya no puedes cambiar la moneda")).toBeTruthy();
  });

  it("draws what it is given next to the card", () => {
    render(<CurrencyDemo instant beside={<p>La tarjeta del grillo</p>} />);
    expect(screen.getByText("La tarjeta del grillo")).toBeTruthy();
  });
});

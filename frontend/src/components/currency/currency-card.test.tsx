import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CurrencyCard } from "./currency-card";

// The edges are mocked: the typed browser client, the router and the width. The card, the picker,
// the dialog and the sheet are the real ones. What is under test is what the person sees and what
// goes to the backend when they change the currency.
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  desktop: false,
}));

vi.mock("@/lib/api/browser", () => ({ browserApi: { GET: mocks.get, PATCH: mocks.patch } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/components/use-is-desktop", () => ({
  DESKTOP_MEDIA_QUERY: "(min-width: 64rem)",
  useIsDesktop: () => mocks.desktop,
}));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SPACE = { id: "space-1", currency: { code: "UYU" } };
// As the backend sends them: in no particular order, only the code and the exponent.
const CURRENCIES = [
  { code: "EUR", exponent: 2 },
  { code: "ARS", exponent: 2 },
  { code: "USD", exponent: 2 },
  { code: "UYU", exponent: 2 },
  { code: "COP", exponent: 2 },
  { code: "BRL", exponent: 2 },
];

function ok(data: unknown) {
  return { data, response: new Response(null, { status: 200 }) };
}

function failure(status: number, body?: unknown) {
  return { error: body, response: new Response(null, { status }) };
}

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue(ok(CURRENCIES));
  mocks.patch
    .mockReset()
    .mockResolvedValue(ok({ ...SPACE, currency: { code: "COP", exponent: 2 } }));
  mocks.refresh.mockReset();
  mocks.replace.mockReset();
  mocks.desktop = false;
  vi.stubGlobal("location", { ...window.location, replace: mocks.replace });
});

function renderCard(space = SPACE) {
  // No retries: the app retries a failed query three times with growing waits, which a test cannot wait for.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  // A new element each time, so that rendering again really renders (the same element would bail out).
  const ui = () => (
    <QueryClientProvider client={queryClient}>
      <CurrencyCard space={space} />
    </QueryClientProvider>
  );
  const view = render(ui());
  return { ...view, invalidate, queryClient, again: () => view.rerender(ui()) };
}

function open() {
  fireEvent.click(screen.getByRole("button", { name: "Cambiar" }));
}

/** The dialog or the sheet, once the list has loaded. */
async function opened() {
  open();
  const dialog = await screen.findByRole("dialog", { name: "Moneda de tu espacio" });
  await screen.findAllByRole("radio");
  return dialog;
}

function radio(name: RegExp | string) {
  return screen.getByRole("radio", { name }) as HTMLInputElement;
}

function pressUse() {
  fireEvent.click(screen.getByRole("button", { name: "Usar esta moneda" }));
}

describe("the card", () => {
  it("names the currency of the space in Spanish, with its code, and says until when it can change", () => {
    renderCard();
    const section = screen.getByRole("region", { name: "Moneda de tu espacio" });
    expect(within(section).getByText("Peso uruguayo · UYU")).toBeTruthy();
    expect(
      within(section).getByText("Puedes cambiarla hasta que registres tu primer movimiento."),
    ).toBeTruthy();
    expect(within(section).getByRole("button", { name: "Cambiar" })).toBeTruthy();
  });

  it("follows the currency of the space it is given", () => {
    renderCard({ id: "s", currency: { code: "EUR" } });
    expect(screen.getByText("Euro · EUR")).toBeTruthy();
  });

  it("holds its look in the classes: a glass row below 1024 px and a solid card from there", () => {
    renderCard();
    const section = screen.getByRole("region");
    for (const expected of ["lg:rounded-card", "lg:bg-surface", "lg:border", "lg:p-6"]) {
      expect(section.className).toContain(expected);
    }
    const row = section.firstElementChild as HTMLElement;
    expect(row.className).toContain("card-surface");
    expect(row.className).toContain("lg:contents");
    // The button goes below the note on desktop, and is a 44 px control.
    const button = screen.getByRole("button", { name: "Cambiar" });
    expect(button.className).toContain("lg:order-last");
    expect(button.className).toContain("min-h-11");
    // The note is written once, outside the row, so the text is not duplicated.
    expect(screen.getAllByText(/Puedes cambiarla/)).toHaveLength(1);
  });

  it("does not ask the backend for the list until it is opened", () => {
    renderCard();
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

describe("the picker, as a sheet below 1024 px and a dialog from there", () => {
  it("opens a bottom sheet on a phone, with its visible 'Cancelar'", async () => {
    const sheet = await (async () => {
      renderCard();
      return opened();
    })();
    expect(sheet.getAttribute("data-side")).toBe("bottom");
    expect(within(sheet).getByRole("button", { name: "Cancelar" })).toBeTruthy();
    expect(sheet.textContent).toContain("Todos tus montos usarán esta moneda.");
  });

  it("opens a centered dialog on a desktop, with 'Cancelar' next to the action", async () => {
    mocks.desktop = true;
    renderCard();
    const dialog = await opened();
    expect(dialog.getAttribute("data-slot")).toBe("dialog-content");
    expect(dialog.getAttribute("data-side")).toBeNull();
    expect(dialog.className).toContain("w-120");
    const footer = dialog.querySelector("[data-slot='dialog-footer']") as HTMLElement;
    expect(
      Array.from(footer.querySelectorAll("button")).map((button) => button.textContent),
    ).toEqual(["Cancelar", "Usar esta moneda"]);
  });

  it.each([
    ["a phone", false],
    ["a desktop", true],
  ])(
    "lists the six currencies in the order of the app, with the current one chosen (%s)",
    async (_name, desktop) => {
      mocks.desktop = desktop;
      renderCard();
      await opened();
      const radios = screen.getAllByRole("radio") as HTMLInputElement[];
      expect(radios.map((input) => input.value)).toEqual([
        "UYU",
        "COP",
        "USD",
        "ARS",
        "BRL",
        "EUR",
      ]);
      expect(radio(/Peso uruguayo/).checked).toBe(true);
      expect(radios.filter((input) => input.checked)).toHaveLength(1);
      expect(screen.getByRole("group", { name: "Moneda" })).toBeTruthy();
      for (const [name, code] of [
        [/Dólar estadounidense/, "USD"],
        [/Real brasileño/, "BRL"],
      ] as const) {
        const row = radio(name).closest("label") as HTMLElement;
        expect(row.textContent).toContain(code);
      }
    },
  );

  it("asks for the list once it opens, with the app's client", async () => {
    renderCard();
    await opened();
    expect(mocks.get).toHaveBeenCalledWith("/currencies");
  });

  it("moves the choice with a click on a row", async () => {
    renderCard();
    await opened();
    fireEvent.click(radio(/Euro/));
    expect(radio(/Euro/).checked).toBe(true);
    expect(radio(/Peso uruguayo/).checked).toBe(false);
  });

  it("closes with 'Cancelar' and with Escape, asking nothing of the backend", async () => {
    renderCard();
    const dialog = await opened();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const second = await opened();
    fireEvent.keyDown(second, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("starts from the current currency every time, whatever was chosen and abandoned", async () => {
    renderCard();
    await opened();
    fireEvent.click(radio(/Euro/));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await opened();
    expect(radio(/Peso uruguayo/).checked).toBe(true);
    expect(radio(/Euro/).checked).toBe(false);
  });

  it("keeps the choice when the window changes width and the sheet becomes a dialog", async () => {
    const { again } = renderCard();
    await opened();
    fireEvent.click(radio(/Real brasileño/));
    mocks.desktop = true;
    again();
    await waitFor(() =>
      expect(screen.getByRole("dialog").getAttribute("data-slot")).toBe("dialog-content"),
    );
    expect(radio(/Real brasileño/).checked).toBe(true);
  });
});

describe("while the list loads and when it fails", () => {
  it("shows a skeleton of six rows, announced, and keeps the action off", async () => {
    mocks.get.mockReturnValue(new Promise(() => {}));
    renderCard();
    open();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(dialog.querySelectorAll("[data-slot='skeleton']")).toHaveLength(6);
    expect(within(dialog).getByRole("status").textContent).toBe("Cargando las monedas…");
    expect(screen.queryByRole("radio")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Usar esta moneda" }).getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("shows the error in Spanish with 'Reintentar', and the list once it works", async () => {
    mocks.get.mockResolvedValueOnce(failure(500, { code: "internal_error", detail: "Boom" }));
    renderCard();
    open();
    const dialog = await screen.findByRole("dialog");
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("Algo salió mal de nuestro lado");
    expect(alert.textContent).not.toContain("Boom");
    expect(alert.textContent).not.toContain("internal_error");
    expect(screen.queryByRole("radio")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Usar esta moneda" }).getAttribute("aria-disabled"),
    ).toBe("true");

    fireEvent.click(within(alert).getByRole("button", { name: "Reintentar" }));
    expect(await screen.findAllByRole("radio")).toHaveLength(6);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says it cannot connect when the request does not reach the backend", async () => {
    mocks.get.mockRejectedValue(new TypeError("Failed to fetch"));
    renderCard();
    open();
    const dialog = await screen.findByRole("dialog");
    expect((await within(dialog).findByRole("alert")).textContent).toContain("No pudimos conectar");
  });

  it("goes to /login when the list answers 401", async () => {
    mocks.get.mockResolvedValue(failure(401, { code: "invalid_session", detail: "Expired" }));
    renderCard();
    open();
    await screen.findByRole("dialog");
    // The query client of the app redirects (providers.tsx); this one is a plain one, so the list
    // just fails with the session message and no list is shown.
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("sesión"));
    expect(screen.queryByRole("radio")).toBeNull();
  });
});

describe("using the currency", () => {
  it("sends the chosen one for this space, then refreshes the server data and closes", async () => {
    const { invalidate } = renderCard();
    await opened();
    fireEvent.click(radio(/Peso colombiano/));
    pressUse();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(mocks.patch).toHaveBeenCalledWith("/spaces/{space_id}", {
      params: { path: { space_id: "space-1" } },
      body: { currency: "COP" },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["spaces"] });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the current currency is still the chosen one: it just closes", async () => {
    renderCard();
    await opened();
    pressUse();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("is one request however many times it is pressed, and shows it busy with the list off", async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.patch.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderCard();
    await opened();
    fireEvent.click(radio(/Euro/));
    pressUse();
    const button = screen.getByRole("button", { name: "Usar esta moneda" });
    await waitFor(() => expect(button.getAttribute("aria-busy")).toBe("true"));
    pressUse();
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(radio(/Peso uruguayo/).matches(":disabled")).toBe(true);
    finish(ok({}));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.patch).toHaveBeenCalledTimes(1);
  });

  describe("when the space got its first movement meanwhile (409)", () => {
    const LOCKED = {
      code: "space_has_transactions",
      detail: "The currency cannot be changed once the space has transactions",
    };

    async function tryAndFail() {
      mocks.patch.mockResolvedValue(failure(409, LOCKED));
      renderCard();
      await opened();
      fireEvent.click(radio(/Euro/));
      pressUse();
      return screen.findByText("Ya no puedes cambiar la moneda");
    }

    it("says so inside, in Spanish, and keeps the action off", async () => {
      await tryAndFail();
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("Ya no puedes cambiar la moneda");
      expect(alert.textContent).toContain("Tus datos están a salvo");
      expect(alert.textContent).not.toContain("space_has_transactions");
      expect(alert.textContent).not.toContain("The currency cannot");
      expect(
        screen.getByRole("button", { name: "Usar esta moneda" }).getAttribute("aria-disabled"),
      ).toBe("true");
      // The dialog stays: the person reads the notice.
      expect(screen.getByRole("dialog")).toBeTruthy();
    });

    it("refreshes the page only when the person closes it, so the card goes after they read", async () => {
      await tryAndFail();
      expect(mocks.refresh).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
    });

    it("refreshes once, also if it is closed with Escape", async () => {
      await tryAndFail();
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("explains any other failure in the dialog, keeps the action on, and lets the person retry", async () => {
    mocks.patch.mockResolvedValueOnce(
      failure(422, {
        detail: [{ type: "currency_unsupported", loc: ["body", "currency"], msg: "Unsupported" }],
      }),
    );
    renderCard();
    await opened();
    fireEvent.click(radio(/Euro/));
    pressUse();
    expect(await screen.findByText("Esa moneda no está disponible")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Usar esta moneda" });
    expect(button.getAttribute("aria-disabled")).toBeNull();
    pressUse();
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledTimes(2));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("clears the last attempt's error when it opens again", async () => {
    mocks.patch.mockResolvedValueOnce(failure(500, { code: "internal_error", detail: "x" }));
    renderCard();
    await opened();
    fireEvent.click(radio(/Euro/));
    pressUse();
    await screen.findByText("Algo salió mal de nuestro lado");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await opened();
    expect(screen.queryByText("Algo salió mal de nuestro lado")).toBeNull();
  });

  it("goes to /login when the session ended, without a notice in the dialog", async () => {
    mocks.patch.mockResolvedValue(failure(401, { code: "invalid_session", detail: "Expired" }));
    renderCard();
    await opened();
    fireEvent.click(radio(/Euro/));
    pressUse();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

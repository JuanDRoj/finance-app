import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FirebaseError } from "firebase/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";

// The edges of the screen are mocked: the Firebase SDK, the typed API client and the router.
// What is under test is the screen's own logic: validation, the order of the steps, the
// busy states, the Spanish errors and the accessibility wiring of the fields.
const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  prepareFirebaseAuth: vi.fn(),
  signInForIdToken: vi.fn(),
  signOutQuietly: vi.fn(),
  post: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/lib/firebase", () => ({
  prepareFirebaseAuth: mocks.prepareFirebaseAuth,
  signInForIdToken: mocks.signInForIdToken,
  signOutQuietly: mocks.signOutQuietly,
}));
vi.mock("@/lib/api/browser", () => ({ browserApi: { POST: mocks.post } }));

// No vitest globals, so Testing Library does not clean up by itself.
afterEach(cleanup);

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.prepareFirebaseAuth.mockReset();
  mocks.signInForIdToken.mockReset().mockResolvedValue("fake-id-token");
  mocks.signOutQuietly.mockReset().mockResolvedValue(undefined);
  mocks.post.mockReset().mockResolvedValue({ response: new Response(null, { status: 204 }) });
});

function renderForm() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LoginForm />
    </QueryClientProvider>,
  );
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function button(name: string) {
  return screen.getByRole("button", { name });
}

/** `Button` marks both a loading and a disabled button with `aria-disabled`. */
function isBlocked(element: HTMLElement) {
  return element.getAttribute("aria-disabled") === "true";
}

function backendError(status: number, code: string) {
  return {
    error: { detail: "English detail that must not be shown", code },
    response: new Response(null, { status }),
  };
}

/** A promise that the test settles by hand, to look at the screen while a step is pending. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("LoginForm: Firebase warm-up", () => {
  // Safari blocks a popup opened after a network wait, so Firebase has to be ready before the
  // first tap on "Continuar con Google": it is started when the screen mounts.
  it("starts Firebase Auth when it mounts, before anyone taps anything", () => {
    renderForm();
    expect(mocks.prepareFirebaseAuth).toHaveBeenCalledTimes(1);
    expect(mocks.signInForIdToken).not.toHaveBeenCalled();
  });

  it("does not start it again on later renders (typing, switching mode)", () => {
    renderForm();
    type("Correo electrónico", "ana@correo.com");
    fireEvent.click(button("Crea una"));
    expect(mocks.prepareFirebaseAuth).toHaveBeenCalledTimes(1);
  });
});

describe("LoginForm: validation and field wiring", () => {
  it("shows both fields invalid and wired to their errors when it is sent empty", async () => {
    renderForm();
    fireEvent.click(button("Iniciar sesión"));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(2);

    for (const [label, message] of [
      ["Correo electrónico", "Escribe tu correo."],
      ["Contraseña", "Escribe tu contraseña."],
    ] as const) {
      // The label is bound to the input (getByLabelText finds it through htmlFor / id).
      const input = screen.getByLabelText(label);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      const errorId = input.getAttribute("aria-describedby") ?? "";
      expect(document.getElementById(errorId)?.textContent).toContain(message);
      // `data-invalid` on the Field turns the label red.
      expect(input.closest("[data-slot=field]")?.getAttribute("data-invalid")).toBe("true");
    }
    // Nothing was sent.
    expect(mocks.signInForIdToken).not.toHaveBeenCalled();
    // And the first invalid field has the focus (react-hook-form got the ref through register()).
    expect(document.activeElement).toBe(screen.getByLabelText("Correo electrónico"));
  });

  it("leaves a valid field clean: no aria-invalid and no link to an error", async () => {
    renderForm();
    type("Correo electrónico", "ana@correo.com");
    fireEvent.click(button("Iniciar sesión"));

    const password = await screen.findByLabelText("Contraseña");
    await waitFor(() => expect(password.getAttribute("aria-invalid")).toBe("true"));
    const email = screen.getByLabelText("Correo electrónico");
    expect(email.getAttribute("aria-invalid")).toBeNull();
    expect(email.getAttribute("aria-describedby")).toBeNull();
  });

  it("asks for a real email, in Spanish, instead of the browser's message", async () => {
    renderForm();
    type("Correo electrónico", "ana");
    type("Contraseña", "secreta");
    fireEvent.click(button("Iniciar sesión"));
    const error = await screen.findByRole("alert");
    expect(error.textContent).toContain("Escribe un correo válido");
    expect(mocks.signInForIdToken).not.toHaveBeenCalled();
  });

  it("builds the keyboard and autofill hints for each field", () => {
    renderForm();
    const email = screen.getByLabelText("Correo electrónico") as HTMLInputElement;
    expect(email.type).toBe("email");
    expect(email.inputMode).toBe("email");
    expect(email.autocomplete).toBe("username");
    expect(email.getAttribute("autocapitalize")).toBe("none");
    const password = screen.getByLabelText("Contraseña") as HTMLInputElement;
    expect(password.type).toBe("password");
    expect(password.autocomplete).toBe("current-password");
  });
});

describe("LoginForm: signing in with email", () => {
  it("signs in, exchanges the token for the session, signs out of the SDK and goes home", async () => {
    renderForm();
    type("Correo electrónico", "  ana@correo.com ");
    type("Contraseña", "secreta");
    fireEvent.click(button("Iniciar sesión"));

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
    expect(mocks.signInForIdToken).toHaveBeenCalledWith({
      kind: "email-signin",
      email: "ana@correo.com",
      password: "secreta",
    });
    // The body is exactly what the contract asks for: the token and the device's time zone.
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith("/auth/session", {
      body: {
        id_token: "fake-id-token",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });
    expect(mocks.signOutQuietly).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("signs out of the SDK before it navigates", async () => {
    const order: string[] = [];
    mocks.signOutQuietly.mockImplementation(async () => void order.push("signOut"));
    mocks.replace.mockImplementation(() => void order.push("replace"));
    renderForm();
    type("Correo electrónico", "ana@correo.com");
    type("Contraseña", "secreta");
    fireEvent.click(button("Iniciar sesión"));
    await waitFor(() => expect(order).toEqual(["signOut", "replace"]));
  });

  it("shows a Firebase error in Spanish and does not call the backend", async () => {
    mocks.signInForIdToken.mockRejectedValue(
      new FirebaseError("auth/invalid-credential", "Firebase: Error (auth/invalid-credential)."),
    );
    renderForm();
    type("Correo electrónico", "ana@correo.com");
    type("Contraseña", "equivocada");
    fireEvent.click(button("Iniciar sesión"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Correo o contraseña incorrectos");
    expect(alert.textContent).not.toContain("auth/");
    expect(alert.textContent).not.toContain("Firebase");
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    // The button is usable again to retry.
    expect(isBlocked(button("Iniciar sesión"))).toBe(false);
  });

  it("shows the backend's error in Spanish, never its English detail, and still signs out", async () => {
    mocks.post.mockResolvedValue(backendError(401, "recent_sign_in_required"));
    renderForm();
    type("Correo electrónico", "ana@correo.com");
    type("Contraseña", "secreta");
    fireEvent.click(button("Iniciar sesión"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Vuelve a iniciar sesión");
    expect(alert.textContent).not.toContain("English detail");
    expect(alert.textContent).not.toContain("recent_sign_in_required");
    // The SDK must not keep the user when the exchange failed either.
    expect(mocks.signOutQuietly).toHaveBeenCalledTimes(1);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("explains a rejected time zone without asking the user to fix a field", async () => {
    mocks.post.mockResolvedValue({
      error: {
        detail: [
          { type: "timezone_invalid", loc: ["body", "timezone"], msg: "Invalid IANA timezone" },
        ],
      },
      response: new Response(null, { status: 422 }),
    });
    renderForm();
    type("Correo electrónico", "ana@correo.com");
    type("Contraseña", "secreta");
    fireEvent.click(button("Iniciar sesión"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("No pudimos detectar tu zona horaria");
  });

  it("describes a network failure of the exchange", async () => {
    mocks.post.mockRejectedValue(new TypeError("Failed to fetch"));
    renderForm();
    type("Correo electrónico", "ana@correo.com");
    type("Contraseña", "secreta");
    fireEvent.click(button("Iniciar sesión"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("No pudimos conectar");
    expect(mocks.signOutQuietly).toHaveBeenCalledTimes(1);
  });
});

describe("LoginForm: busy state", () => {
  it("blocks the buttons while it works, sends once, and stays busy until it navigates", async () => {
    const signIn = deferred<string>();
    mocks.signInForIdToken.mockReturnValue(signIn.promise);
    renderForm();
    type("Correo electrónico", "ana@correo.com");
    type("Contraseña", "secreta");
    const submit = button("Iniciar sesión");
    fireEvent.click(submit);

    await waitFor(() => expect(submit.getAttribute("aria-busy")).toBe("true"));
    expect(isBlocked(submit)).toBe(true);
    // The other ways to act are blocked too.
    expect(isBlocked(button("Continuar con Google"))).toBe(true);
    expect(isBlocked(button("Crea una"))).toBe(true);

    // A second tap (or Enter in a field) does not send again.
    fireEvent.click(submit);
    fireEvent.click(button("Continuar con Google"));
    expect(mocks.signInForIdToken).toHaveBeenCalledTimes(1);

    signIn.resolve("fake-id-token");
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
    // After success it does not flip back to idle while the navigation happens.
    expect(isBlocked(button("Iniciando sesión…"))).toBe(true);
  });

  it("shows the busy label and keeps the focus on the button", async () => {
    mocks.signInForIdToken.mockReturnValue(deferred<string>().promise);
    renderForm();
    type("Correo electrónico", "ana@correo.com");
    type("Contraseña", "secreta");
    button("Iniciar sesión").focus();
    fireEvent.click(button("Iniciar sesión"));
    const busy = await screen.findByRole("button", { name: "Iniciando sesión…" });
    expect(document.activeElement).toBe(busy);
  });
});

describe("LoginForm: Google", () => {
  it("signs in with the Google popup and follows the same exchange", async () => {
    renderForm();
    fireEvent.click(button("Continuar con Google"));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
    expect(mocks.signInForIdToken).toHaveBeenCalledWith({ kind: "google" });
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.signOutQuietly).toHaveBeenCalledTimes(1);
  });

  it("marks the Google button busy (not the submit one) while the popup is open", async () => {
    mocks.signInForIdToken.mockReturnValue(deferred<string>().promise);
    renderForm();
    fireEvent.click(button("Continuar con Google"));
    const google = button("Continuar con Google");
    await waitFor(() => expect(google.getAttribute("aria-busy")).toBe("true"));
    const submit = button("Iniciar sesión");
    expect(submit.getAttribute("aria-busy")).toBeNull();
    expect(isBlocked(submit)).toBe(true);
  });

  it("shows no error when the user closes the popup, and the buttons come back", async () => {
    mocks.signInForIdToken.mockRejectedValue(
      new FirebaseError(
        "auth/popup-closed-by-user",
        "Firebase: Error (auth/popup-closed-by-user).",
      ),
    );
    renderForm();
    fireEvent.click(button("Continuar con Google"));
    await waitFor(() => expect(mocks.signOutQuietly).toHaveBeenCalled());
    await waitFor(() => expect(isBlocked(button("Continuar con Google"))).toBe(false));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(isBlocked(button("Iniciar sesión"))).toBe(false);
  });

  it("tells the user to allow pop-ups when the browser blocked the window", async () => {
    mocks.signInForIdToken.mockRejectedValue(
      new FirebaseError("auth/popup-blocked", "Firebase: Error (auth/popup-blocked)."),
    );
    renderForm();
    fireEvent.click(button("Continuar con Google"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("bloqueó la ventana de Google");
  });
});

describe("LoginForm: creating an account", () => {
  it("switches the screen to sign-up and back, keeping the email but not the password", async () => {
    renderForm();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Entra a tu cuenta");
    type("Correo electrónico", "ana@correo.com");
    type("Contraseña", "secreta");

    fireEvent.click(button("Crea una"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Crea tu cuenta");
    expect(button("Crear cuenta")).toBeTruthy();
    expect((screen.getByLabelText("Correo electrónico") as HTMLInputElement).value).toBe(
      "ana@correo.com",
    );
    expect((screen.getByLabelText("Contraseña") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Contraseña") as HTMLInputElement).autocomplete).toBe(
      "new-password",
    );
    expect(screen.getByText("Mínimo 8 caracteres.")).toBeTruthy();

    fireEvent.click(button("Entra"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Entra a tu cuenta");
    expect(screen.queryByText("Mínimo 8 caracteres.")).toBeNull();
  });

  it("clears the errors when the mode changes", async () => {
    mocks.signInForIdToken.mockRejectedValue(
      new FirebaseError("auth/invalid-credential", "Firebase: Error (auth/invalid-credential)."),
    );
    renderForm();
    type("Correo electrónico", "ana@correo.com");
    type("Contraseña", "secreta");
    fireEvent.click(button("Iniciar sesión"));
    await screen.findByRole("alert");

    fireEvent.click(button("Crea una"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks for at least 8 characters, and the description and the error are both linked", async () => {
    renderForm();
    fireEvent.click(button("Crea una"));
    type("Correo electrónico", "ana@correo.com");
    type("Contraseña", "corta");
    fireEvent.click(button("Crear cuenta"));

    const error = await screen.findByRole("alert");
    expect(error.textContent).toContain("Usa al menos 8 caracteres.");
    const password = screen.getByLabelText("Contraseña");
    expect(password.getAttribute("aria-invalid")).toBe("true");
    expect(password.getAttribute("aria-describedby")).toBe(
      `${screen.getByText("Mínimo 8 caracteres.").id} ${error.id}`,
    );
    expect(mocks.signInForIdToken).not.toHaveBeenCalled();
  });

  it("creates the account and follows the same exchange", async () => {
    renderForm();
    fireEvent.click(button("Crea una"));
    type("Correo electrónico", "ana@correo.com");
    type("Contraseña", "una-clave-larga");
    fireEvent.click(button("Crear cuenta"));

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
    expect(mocks.signInForIdToken).toHaveBeenCalledWith({
      kind: "email-signup",
      email: "ana@correo.com",
      password: "una-clave-larga",
    });
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.signOutQuietly).toHaveBeenCalledTimes(1);
  });

  it("tells the user that the email is taken and what to do", async () => {
    mocks.signInForIdToken.mockRejectedValue(
      new FirebaseError(
        "auth/email-already-in-use",
        "Firebase: Error (auth/email-already-in-use).",
      ),
    );
    renderForm();
    fireEvent.click(button("Crea una"));
    type("Correo electrónico", "ana@correo.com");
    type("Contraseña", "una-clave-larga");
    fireEvent.click(button("Crear cuenta"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Ya existe una cuenta con ese correo");
    expect(alert.textContent).toContain("Inicia sesión");
  });
});

describe("LoginForm: Kanza peek", () => {
  it("shows the cricket as a decorative image placed before the form card", () => {
    const { container } = renderForm();
    const peek = container.querySelector('img[src*="kanza-peek"]');
    expect(peek).not.toBeNull();
    // Decorative: empty alt, so it has no accessible name and screen readers skip it.
    expect(peek?.getAttribute("alt")).toBe("");
    expect(screen.queryByRole("img")).toBeNull();
    // It comes first in its wrapper, and the wrapper holds the form: it peeks over the card.
    const wrapper = peek?.parentElement;
    expect(wrapper?.firstElementChild).toBe(peek);
    expect(wrapper?.querySelector("form")).not.toBeNull();
  });
});

describe("LoginForm: layout of the card", () => {
  it("puts the email form first, then the separator, then Google, in both modes", () => {
    const { container } = renderForm();
    const order = () => {
      const card = container.querySelector("[data-slot=card]") as HTMLElement;
      const form = card.querySelector("form") as HTMLElement;
      const google = button("Continuar con Google");
      const separator = [...card.querySelectorAll("span")].find((el) => el.textContent === "o");
      expect(separator).toBeTruthy();
      // DOM order: form, then separator, then the Google button.
      expect(
        form.compareDocumentPosition(separator as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        (separator as Node).compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(form.contains(google)).toBe(false);
    };
    order();
    expect(screen.queryByText("o con tu correo")).toBeNull();
    fireEvent.click(button("Crea una"));
    order();
  });

  it("says Iniciar sesión on the submit button when signing in, and keeps Crear cuenta", () => {
    renderForm();
    expect(button("Iniciar sesión")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Entrar" })).toBeNull();
    // The heading is not renamed.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Entra a tu cuenta");
    fireEvent.click(button("Crea una"));
    expect(button("Crear cuenta")).toBeTruthy();
  });

  it("gives both inputs a placeholder and a decorative icon, without replacing the labels", () => {
    const { container } = renderForm();
    const email = screen.getByLabelText("Correo electrónico");
    const password = screen.getByLabelText("Contraseña");
    expect(email.getAttribute("placeholder")).toBe("tu@correo.com");
    expect(password.getAttribute("placeholder")).toBe("Tu contraseña");
    // One decorative icon per input, hidden from assistive tech, and the labels remain.
    const icons = container.querySelectorAll("form [aria-hidden=true] > svg");
    expect(icons.length).toBeGreaterThanOrEqual(2);
    expect(email.className).toContain("pl-11");
    expect(password.className).toContain("pl-11");
    expect(password.className).toContain("pr-14");
  });

  it("shows and hides the password without submitting or losing what was typed", () => {
    renderForm();
    const password = screen.getByLabelText("Contraseña") as HTMLInputElement;
    type("Contraseña", "secreta123");
    expect(password.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(password.type).toBe("text");
    expect(password.value).toBe("secreta123");
    fireEvent.click(screen.getByRole("button", { name: "Ocultar contraseña" }));
    expect(password.type).toBe("password");
    expect(mocks.signInForIdToken).not.toHaveBeenCalled();
    expect(password.autocomplete).toBe("current-password");
  });
});

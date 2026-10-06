import { describeApiError, GENERIC_ERROR, NETWORK_ERROR, type ErrorDescription } from "./i18n";

/**
 * Spanish text for what can go wrong while signing in with Firebase Auth (email and password, or
 * the Google popup). Pure on purpose: it reads the `code` of a `FirebaseError` structurally and
 * never imports the SDK, so it can be shared with the native app.
 *
 * Tone (docs/diseno.md D13): what happened, what to do, and that the data is safe when it
 * applies. The wrong-credential family says the same thing for every cause, so the screen never
 * reveals whether an email has an account.
 */

const SAFE = "Tus datos están a salvo.";

const WRONG_CREDENTIALS: ErrorDescription = {
  title: "Correo o contraseña incorrectos",
  message: "Revisa tus datos e inténtalo de nuevo. Si aún no tienes cuenta, crea una.",
};

/** Firebase `code` to text. The `auth/` prefix is part of the key. */
const ERROR_BY_CODE: Record<string, ErrorDescription> = {
  // Newer projects answer `invalid-credential` for every wrong email or password (email
  // enumeration protection); the other three are what older ones and the emulator may send.
  "auth/invalid-credential": WRONG_CREDENTIALS,
  "auth/invalid-login-credentials": WRONG_CREDENTIALS,
  "auth/wrong-password": WRONG_CREDENTIALS,
  "auth/user-not-found": WRONG_CREDENTIALS,
  "auth/invalid-email": {
    title: "El correo no es válido",
    message: "Revisa que esté bien escrito, por ejemplo nombre@correo.com.",
  },
  "auth/user-disabled": {
    title: "No puedes entrar con esta cuenta",
    message: "Está desactivada. Si crees que es un error, prueba con otra cuenta.",
  },
  "auth/too-many-requests": {
    title: "Demasiados intentos",
    message: `Espera unos minutos e inténtalo de nuevo. ${SAFE}`,
  },
  "auth/email-already-in-use": {
    title: "Ya existe una cuenta con ese correo",
    message: "Inicia sesión con ese correo o usa otro para crear tu cuenta.",
  },
  "auth/weak-password": {
    title: "La contraseña es muy débil",
    message: "Elige una más larga y difícil de adivinar.",
  },
  "auth/operation-not-allowed": {
    title: "Este método de acceso no está disponible",
    message: `Prueba con otro método o inténtalo más tarde. ${SAFE}`,
  },
  "auth/account-exists-with-different-credential": {
    title: "Ese correo ya se usa con otro método",
    message: "Entra con el método que usaste al crear tu cuenta: correo y contraseña, o Google.",
  },
  "auth/popup-blocked": {
    title: "Tu navegador bloqueó la ventana de Google",
    message: "Permite las ventanas emergentes de este sitio e inténtalo de nuevo.",
  },
  "auth/network-request-failed": NETWORK_ERROR,
  "auth/unauthorized-domain": {
    title: "No pudimos iniciar sesión desde esta dirección",
    message: "Abre la app desde su dirección habitual e inténtalo de nuevo.",
  },
  "auth/operation-not-supported-in-this-environment": {
    title: "Tu navegador no permite iniciar sesión así",
    message: "Activa las cookies y el almacenamiento del sitio, o prueba con otro navegador.",
  },
  "auth/web-storage-unsupported": {
    title: "Tu navegador no permite iniciar sesión así",
    message: "Activa las cookies y el almacenamiento del sitio, o prueba con otro navegador.",
  },
  "auth/internal-error": {
    title: "Algo salió mal al iniciar sesión",
    message: `Inténtalo de nuevo en unos minutos. ${SAFE}`,
  },
};

/** The user closed the popup or opened a second one: nothing went wrong, so nothing is shown. */
const CANCELLED_CODES: ReadonlySet<string> = new Set([
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
]);

function authCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { code } = error as Record<string, unknown>;
  return typeof code === "string" && code.startsWith("auth/") ? code : undefined;
}

/** A `FirebaseError` from Firebase Auth: an object whose `code` starts with `auth/`. */
export function isFirebaseAuthError(error: unknown): error is { code: string } {
  return authCode(error) !== undefined;
}

/** The user backed out of the Google popup. The screen shows no error for it. */
export function isSignInCancelled(error: unknown): boolean {
  const code = authCode(error);
  return code !== undefined && CANCELLED_CODES.has(code);
}

/**
 * Spanish text for a Firebase Auth error. A code it does not know gets the generic message
 * (never the code or Firebase's English text).
 */
export function describeFirebaseAuthError(error: unknown): ErrorDescription {
  const code = authCode(error);
  if (code !== undefined && Object.hasOwn(ERROR_BY_CODE, code)) {
    return ERROR_BY_CODE[code] ?? GENERIC_ERROR;
  }
  return GENERIC_ERROR;
}

/**
 * Whatever failed during login, as text for an `Alert`: Firebase errors from the sign-in step,
 * and everything else (the `ApiError` of `POST /auth/session`, a network failure) through
 * `describeApiError`.
 */
export function describeLoginError(error: unknown): ErrorDescription {
  return isFirebaseAuthError(error) ? describeFirebaseAuthError(error) : describeApiError(error);
}

/**
 * Whether going back stays inside this app: the page has a history before it and the page that
 * sent the visitor here is of this same origin. A page opened directly (a typed address, a link
 * from elsewhere, a new tab) has neither, and "atrás" would leave the app or do nothing. Browser
 * only (it reads `window` and `document`): call it from an event handler, never while rendering.
 *
 * One rule for everything that "goes back": the "Volver" of a form screen (`BackLink`) and the
 * form of a new account, which returns to where the person was once it has created the account.
 */
export function canGoBackInApp(): boolean {
  if (window.history.length <= 1 || document.referrer === "") return false;
  try {
    return new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

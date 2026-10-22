/**
 * The side panel lives in the URL as `?{param}={value}` (the new account is `?cuenta=nueva`), so a
 * refresh keeps it open and a link can open it. It is written with the browser's own History API:
 * Next.js integrates `pushState` / `replaceState` with the router, so `useSearchParams` sees the
 * change at once and nothing is asked of the server (node_modules/next/dist/docs, guide
 * "single-page-applications" > "Shallow routing on the client"). `replaceState`, not `pushState`:
 * opening and closing the panel adds no entries to the history, so "atrás" leaves the screen
 * instead of toggling the panel.
 */

export type PanelRef = { param: string; value: string };

/** The panel the form of a new account opens in (`PRIMARY_ACTION.panel`). */
export const NEW_ACCOUNT_PANEL: PanelRef = { param: "cuenta", value: "nueva" };

function writeUrl(url: URL): void {
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/** Adds `?{param}={value}` to the current URL, leaving the path and the other params as they are. */
export function openPanelInUrl({ param, value }: PanelRef): void {
  const url = new URL(window.location.href);
  url.searchParams.set(param, value);
  writeUrl(url);
}

/** Takes `?{param}` out of the current URL. */
export function closePanelInUrl(param: string): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(param);
  writeUrl(url);
}

/** The query param that names the account shown in the detail of Cuentas (`/cuentas?sel=<id>`). */
export const SELECTED_ACCOUNT_PARAM = "sel";

/** The panels of an existing account: `?cuenta=editar` and `?cuenta=cuadrar`, over `?sel=<id>`. */
export type AccountPanelView = "editar" | "cuadrar";

/**
 * Opens the edit or the reconcile panel of an account in one write: `?sel=<id>&cuenta=<view>`. Both
 * go together because the detail may be showing an account that no `?sel` names (the first one).
 */
export function openAccountPanelInUrl(view: AccountPanelView, accountId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set(SELECTED_ACCOUNT_PARAM, accountId);
  url.searchParams.set("cuenta", view);
  writeUrl(url);
}

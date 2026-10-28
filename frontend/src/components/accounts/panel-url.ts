/**
 * The side panel lives in the URL as `?{param}={value}` (the new account is `?cuenta=nueva`), so a
 * refresh keeps it open and a link can open it. It is written with the browser's own History API:
 * Next.js integrates `pushState` / `replaceState` with the router, so `useSearchParams` sees the
 * change at once and nothing is asked of the server (node_modules/next/dist/docs, guide
 * "single-page-applications" > "Shallow routing on the client"). `replaceState`, not `pushState`:
 * opening and closing the panel adds no entries to the history, so "atrás" leaves the screen
 * instead of toggling the panel.
 */

export type PanelRef = {
  param: string;
  value: string;
  /**
   * Params that travel with the panel (KAN-77: `?categoria=nueva&tipo=ingresos&padre=<id>`, the kind
   * and the principal a new category starts on): written by `openPanelInUrl` in the same write.
   */
  extra?: Readonly<Record<string, string>>;
};

/** The panel the form of a new account opens in (`NEW_ACCOUNT_ACTION.panel`). */
export const NEW_ACCOUNT_PANEL: PanelRef = { param: "cuenta", value: "nueva" };

/**
 * The panel "Registrar movimiento" opens in (`PRIMARY_ACTION.panel`, KAN-76): `?movimiento=nuevo`.
 * Below 1024 px it is the bottom sheet, from 1024 px the side panel; the same URL opens either.
 * FE-23 will add `?movimiento=editar` for editing one.
 */
export const MOVEMENT_PANEL: PanelRef = { param: "movimiento", value: "nuevo" };

function writeUrl(url: URL): void {
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * Adds `?{param}={value}` (and its `extra` params) to the current URL, leaving the path and the
 * other params as they are.
 */
export function openPanelInUrl({ param, value, extra }: PanelRef): void {
  const url = new URL(window.location.href);
  url.searchParams.set(param, value);
  for (const [key, text] of Object.entries(extra ?? {})) url.searchParams.set(key, text);
  writeUrl(url);
}

/** Takes `?{param}` out of the current URL, and the params that went with it (`alsoRemove`), in one write. */
export function closePanelInUrl(param: string, ...alsoRemove: string[]): void {
  const url = new URL(window.location.href);
  for (const name of [param, ...alsoRemove]) url.searchParams.delete(name);
  writeUrl(url);
}

/**
 * Swaps one panel for another in a single write: takes `?{from}` out and puts `?{param}={value}`.
 * Used when "Registrar movimiento" finds there is no account to register on and hands over to "Nueva
 * cuenta": one write, so the URL never has both and the history gets no entry.
 */
export function replacePanelInUrl(from: string, { param, value }: PanelRef): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(from);
  url.searchParams.set(param, value);
  writeUrl(url);
}

/**
 * The side panel of a category (KAN-77), over Categorías: `?categoria=nueva` (with `&tipo=gastos|ingresos`
 * and `&padre=<id>` for the kind and the principal it starts on) or `?categoria=editar&id=<id>`.
 * `value` is the one of "nueva"; the edit panel is `categoryEditPanel`.
 */
export const CATEGORY_PANEL: PanelRef = { param: "categoria", value: "nueva" };

/** The params of the category panel besides `?categoria`: closing it takes them out (`tipo` stays: it is the tab of the list). */
export const CATEGORY_PANEL_COMPANIONS = ["id", "padre"] as const;

/** The edit panel of the category with this id (`?categoria=editar&id=<id>`). */
export function categoryEditPanel(categoryId: string): PanelRef {
  return { param: "categoria", value: "editar", extra: { id: categoryId } };
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

import { DotsThree, House } from "@phosphor-icons/react/ssr";

/** Any Phosphor icon (the library does not export its `Icon` type from the `/ssr` entry). */
type NavIcon = typeof House;

export type NavSection = {
  id: string;
  href: string;
  /** The name of the section: the text of its link in the sidebar and the bottom bar. */
  label: string;
  icon: NavIcon;
};

/** An entry of the "Más" screen and, on desktop, of the bottom group of the sidebar. */
export type MoreSection = NavSection & {
  /** The secondary line of its row in "Más". */
  description: string;
};

/**
 * What the "+" of the bottom bar and the "Registrar" button of the sidebar do. `label` is the
 * `aria-label` of the "+"; `buttonText` is the visible text of the sidebar button (docs/diseno.md
 * D17 › Navegación del Hito 1).
 */
export type PrimaryAction = {
  /** Where it goes below 1024 px (and with no JavaScript): a page of its own. */
  href: string;
  label: string;
  buttonText: string;
  /**
   * From 1024 px the action does not leave the screen: it opens its side panel over it, by adding
   * `?{param}={value}` to the current URL (`AccountPanelHost` reads it). Without it, the action
   * is just a link.
   */
  panel?: { param: string; value: string };
};

/** Everything the navigation shows. Components read it from `NAV`; the catalog passes its own. */
export type NavConfig = {
  sections: readonly NavSection[];
  more: readonly MoreSection[];
  action: PrimaryAction | null;
};

/**
 * The sections of the app (docs/diseno.md D17), in the order the navigation shows them. A
 * section is listed when its screen exists (no link may lead to a 404): the task that builds a
 * screen adds its entry here. Hito 1 ends with Inicio, Movimientos and Cuentas; today only Inicio
 * exists. The sidebar and the bottom bar read this list. It holds icons, which are functions, so a
 * Server Component can read the data but must not pass it to a Client Component as a prop.
 */
export const NAV_SECTIONS: readonly NavSection[] = [
  { id: "home", href: "/", label: "Inicio", icon: House },
];

/**
 * What hangs from "Más" on a phone and sits at the bottom of the sidebar on desktop. Empty until
 * Categorías exists (FE-21, KAN-77); with entries, the bottom bar shows "Más" and `/mas` lists
 * them. Hito 3 adds Ayuda and Ajustes.
 */
export const MORE_SECTIONS: readonly MoreSection[] = [];

/** The "Más" tab of the bottom bar (only shown when `MORE_SECTIONS` has entries). */
export const MORE_ITEM: NavSection = { id: "more", href: "/mas", label: "Más", icon: DotsThree };

/**
 * What the "+" of the bottom bar and the button of the sidebar do. Until the panel to register a
 * movement exists (FE-20) they open the form of a new account (docs/diseno.md D17, D18): a page
 * below 1024 px (`/cuentas/nueva`) and, from 1024 px, the side panel over the current screen
 * (`?cuenta=nueva`). FE-20 changes the destination and the texts to "Registrar movimiento" and
 * "Registrar". It is `null` only while there is no screen to open at all.
 */
export const PRIMARY_ACTION: PrimaryAction | null = {
  href: "/cuentas/nueva",
  label: "Nueva cuenta",
  buttonText: "Nueva cuenta",
  panel: { param: "cuenta", value: "nueva" },
};

export const NAV: NavConfig = {
  sections: NAV_SECTIONS,
  more: MORE_SECTIONS,
  action: PRIMARY_ACTION,
};

/**
 * Whether `pathname` is inside the section that lives at `href`. The home (`/`) is only itself;
 * any other section also owns what hangs below it by whole segments (`/movimientos/abc` is in
 * `/movimientos`, `/movimientos-viejos` is not).
 */
export function isSectionActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** "Más" is the current tab on its own screen and on every screen that hangs from it. */
export function isMoreActive(pathname: string, more: readonly MoreSection[]): boolean {
  return (
    isSectionActive(pathname, MORE_ITEM.href) ||
    more.some((section) => isSectionActive(pathname, section.href))
  );
}

/** The tabs of the bottom bar, in order: the sections, then "Más" if anything hangs from it. */
export function barItems(
  sections: readonly NavSection[],
  more: readonly MoreSection[],
): NavSection[] {
  return more.length > 0 ? [...sections, MORE_ITEM] : [...sections];
}

/**
 * Splits the tabs around the "+", which sits in the middle: the left side gets the extra tab when
 * the count is odd. Four tabs (the end of Hito 1) are two and two, as in the canvas.
 */
export function splitAroundAction<T>(items: readonly T[]): { before: T[]; after: T[] } {
  const middle = Math.ceil(items.length / 2);
  return { before: items.slice(0, middle), after: items.slice(middle) };
}

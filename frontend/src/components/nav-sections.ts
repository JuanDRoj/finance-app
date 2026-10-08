import { House } from "@phosphor-icons/react/ssr";

/** Any Phosphor icon (the library does not export its `Icon` type from the `/ssr` entry). */
type NavIcon = typeof House;

export type NavSection = {
  id: string;
  href: string;
  /** What the icon is called: its `aria-label` and the text of its tooltip. */
  label: string;
  icon: NavIcon;
};

/**
 * The sections of the app (docs/diseno.md D17), in the order the navigation shows them. In
 * Hito 0 only Inicio exists. A new section is one more entry here: the desktop sidebar (and the
 * bottom bar, when it arrives in Hito 1) read this list. It is imported by Client Components only:
 * a function (the icon) cannot cross from a Server Component to a Client one.
 */
export const NAV_SECTIONS: readonly NavSection[] = [
  { id: "home", href: "/", label: "Inicio", icon: House },
];

/**
 * Whether `pathname` is inside the section that lives at `href`. The home (`/`) is only itself;
 * any other section also owns what hangs below it by whole segments (`/movimientos/abc` is in
 * `/movimientos`, `/movimientos-viejos` is not).
 */
export function isSectionActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

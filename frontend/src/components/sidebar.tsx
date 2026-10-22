import { Plus } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { KanzaBrand } from "@/components/brand/kanza-brand";
import { NAV, type NavConfig } from "@/components/nav-sections";
import { SIDEBAR_CARD_POSITION } from "@/components/shell-layout";
import { SidebarNav } from "@/components/sidebar-nav";
import { sidebarFocusRing } from "@/components/ui/focus";
import { UserMenu, type UserMenuUser } from "@/components/user-menu";
import { describeCurrency } from "@/lib/core/i18n";
import { spaceInitialOf } from "@/lib/core/user";
import { cn } from "@/lib/utils";

/** What the sidebar shows about the space: its name and the code of its currency. */
export type SidebarSpace = { name: string; currency: { code: string } };

/**
 * The card itself, without its position: dark in both themes, 28 px radius, padding 20/14 px and
 * 18 px between its blocks. If the window is too short for everything, the card scrolls inside
 * (the page does not). `Sidebar` pins it (`sticky`); the catalog shows it in the page.
 */
export const SIDEBAR_CARD =
  "flex flex-col gap-4.5 overflow-y-auto overscroll-contain rounded-tile border border-sidebar-border bg-sidebar px-3.5 py-5";

type SidebarBodyProps = {
  user?: UserMenuUser;
  space?: SidebarSpace;
  /** Only the catalog passes it, to show the whole navigation; the app reads `NAV`. */
  nav?: NavConfig;
  pathname?: string;
};

/**
 * What goes inside the card, from the top: the logo, the space (name and currency; one space in
 * v1, so it is not interactive), the button of the main action, the sections, and at the bottom
 * the entries of "Más" (Categorías) and the account of the user with its menu. Not a component of
 * its own in the app: `Sidebar` is its only user, apart from the catalog.
 */
export function SidebarBody({ user, space, nav, pathname }: SidebarBodyProps) {
  const action = (nav ?? NAV).action;
  const initial = space ? spaceInitialOf(space.name) : null;

  return (
    <>
      <KanzaBrand size="compact" tone="sidebar" className="px-2" />

      {space ? (
        <div className="flex min-h-12 items-center gap-2.5 rounded-field border border-sidebar-line bg-sidebar-surface px-2.5 py-2">
          <span
            aria-hidden
            className="flex size-7.5 shrink-0 items-center justify-center rounded-tooltip bg-sidebar-tile font-heading text-sm font-bold text-sidebar-tile-foreground"
          >
            {initial ?? "•"}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-bold text-sidebar-title">{space.name}</span>
            <span className="truncate text-caption text-sidebar-foreground">
              {describeCurrency(space.currency.code)}
            </span>
          </span>
        </div>
      ) : null}

      {action ? (
        // The text is the name: no `aria-label` (WCAG 2.5.3). The "N" hint comes with the shortcut.
        <Link
          href={action.href}
          className={cn(
            "flex min-h-11.5 items-center justify-center gap-2 rounded-full bg-sidebar-primary px-4 text-item font-bold text-sidebar-primary-foreground transition-[transform,opacity] duration-150 ease-out hover:opacity-90 active:scale-[0.98]",
            sidebarFocusRing,
          )}
        >
          <Plus aria-hidden weight="bold" className="size-4.5 shrink-0" />
          {action.buttonText}
        </Link>
      ) : null}

      <SidebarNav group="main" nav={nav} pathname={pathname} />

      <div className="mt-auto flex flex-col gap-1">
        <SidebarNav group="more" nav={nav} pathname={pathname} />
        <UserMenu variant="sidebar" user={user} />
      </div>
    </>
  );
}

/**
 * The desktop sidebar (docs/diseno.md D17 › Escritorio v2), as in the Kanza canvas: from 1024 px
 * (`lg`) a floating dark card 240 px wide (216 at the least), `sticky` 16 px from the top and as
 * tall as a screen minus the padding of the group around it. Below 1024 px it is `display: none`,
 * so none of it takes focus or is read.
 *
 * Its height is a screen minus the padding of the group (16 px above, 24 px below, each `max()`
 * with the safe-area inset): see `shell-layout.ts`, which keeps both in step and has a test. That
 * makes a short page exactly one screen tall, so it does not scroll; the air under the card is
 * 24 px, as in the canvas. The card is inside a plain column that stretches with the page.
 * `data-slot="sidebar"` is what the catalog's audit panel looks for. A Server Component: only the
 * links (`SidebarNav`) and the account menu (`UserMenu`) are client islands.
 */
export function Sidebar({ user, space }: Readonly<{ user?: UserMenuUser; space?: SidebarSpace }>) {
  return (
    <div data-slot="sidebar" className="hidden lg:block lg:w-60 lg:min-w-54 lg:shrink">
      <div className={cn(SIDEBAR_CARD_POSITION, SIDEBAR_CARD)}>
        <SidebarBody user={user} space={space} />
      </div>
    </div>
  );
}

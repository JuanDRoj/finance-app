"use client";

import { Plus } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import {
  NAV,
  barItems,
  isMoreActive,
  isSectionActive,
  splitAroundAction,
  type NavConfig,
  type NavSection,
} from "@/components/nav-sections";
import { focusRing } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

type BottomNavBarProps = ComponentProps<"nav"> & {
  nav: NavConfig;
  pathname: string;
};

function BarLink({ item, active }: Readonly<{ item: NavSection; active: boolean }>) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        // At least 64 x 52 px and no side padding, as in the canvas: with the five tabs at 360 px the bar
        // (336 px) has only ~25 px to spare, and "Movimientos" at 11 px is wider than 64 px.
        "flex min-h-13 min-w-16 flex-col items-center justify-center gap-0.5 rounded-xl text-nav-label [-webkit-touch-callout:none] select-none md:text-xs",
        "transition-[transform,background-color] duration-150 ease-out active:scale-[0.97]",
        active
          ? "bg-primary/10 font-bold text-primary dark:bg-primary/14"
          : "font-semibold text-muted-foreground hover:text-foreground",
        focusRing,
      )}
    >
      <Icon aria-hidden weight={active ? "fill" : "regular"} className="size-5.5 shrink-0" />
      {item.label}
    </Link>
  );
}

/**
 * The look of the bottom bar, without a position: the tabs, the "+" in the middle and nothing
 * else (docs/diseno.md D17 › Navegación del Hito 1). `BottomNav` pins it to the screen; the
 * catalog shows it in the page with its own `nav`. A tab is only drawn if its screen exists
 * (`NavConfig`), and the "+" only if there is an action.
 */
export function BottomNavBar({ nav, pathname, className, ...props }: BottomNavBarProps) {
  const items = barItems(nav.sections, nav.more);
  const { before, after } = nav.action
    ? splitAroundAction(items)
    : { before: items, after: [] as NavSection[] };

  const tab = (item: NavSection) => (
    <BarLink
      key={item.id}
      item={item}
      active={
        item.id === "more" ? isMoreActive(pathname, nav.more) : isSectionActive(pathname, item.href)
      }
    />
  );

  return (
    <nav
      aria-label="Principal"
      className={cn(
        "glass flex h-(--bottom-nav-height) items-center justify-around rounded-nav shadow-nav",
        className,
      )}
      {...props}
    >
      {before.map(tab)}
      {nav.action ? (
        <Link
          href={nav.action.href}
          aria-label={nav.action.label}
          className={cn(
            "flex size-13 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-fab md:size-13.5",
            "transition-transform duration-150 ease-out active:scale-[0.95]",
            focusRing,
          )}
        >
          <Plus aria-hidden weight="bold" className="size-6" />
        </Link>
      ) : null}
      {after.map(tab)}
    </nav>
  );
}

/**
 * The bottom bar of phones and tablets (docs/diseno.md D17): a floating glass card, 12 px from the
 * sides and from the bottom (or the safe area, whichever is greater), 68 px tall; from 768 px it
 * is 480 px wide and centered. From 1024 px it is gone (`lg:hidden`) and the sidebar takes over.
 * `data-slot="bottom-nav"` is what `globals.css` looks for to raise the toast above it, and what
 * the catalog's audit panel looks for. `AppShell` draws it unless the screen asks not to (a form).
 */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <BottomNavBar
      nav={NAV}
      pathname={pathname}
      data-slot="bottom-nav"
      className="fixed bottom-(--bottom-nav-offset) left-[max(0.75rem,env(safe-area-inset-left,0px))] z-40 right-[max(0.75rem,env(safe-area-inset-right,0px))] md:right-auto md:left-1/2 md:w-120 md:-translate-x-1/2 lg:hidden"
    />
  );
}

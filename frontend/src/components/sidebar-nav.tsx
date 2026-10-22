"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, isSectionActive, type NavConfig } from "@/components/nav-sections";
import { sidebarFocusRing } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

type SidebarNavProps = {
  /**
   * `main` is the sections of the app (Inicio, Movimientos, Cuentas); `more` is what hangs from
   * "Más" on a phone and sits at the bottom of the sidebar on desktop (Categorías in Hito 1).
   */
  group: "main" | "more";
  /** Only the catalog passes these two, to show the whole navigation; the app reads `NAV`. */
  nav?: NavConfig;
  pathname?: string;
};

/**
 * The links of the desktop sidebar (docs/diseno.md D17 › Escritorio v2): a link of at least 44 px
 * per section, with its icon (20 px) and its name visible, so the accessible name is the text.
 * The current one (`aria-current="page"`) is shown without relying on color: bold name, filled
 * icon and a translucent mint pill (the one the pointer paints on hover). It is a Client Component
 * for `usePathname`. A group with no entries draws nothing.
 */
export function SidebarNav({ group, nav = NAV, pathname: pathnameOverride }: SidebarNavProps) {
  const current = usePathname();
  const pathname = pathnameOverride ?? current;
  const sections = group === "main" ? nav.sections : nav.more;
  if (sections.length === 0) return null;

  return (
    <nav aria-label={group === "main" ? "Principal" : "Organiza"}>
      <ul className="flex flex-col gap-1">
        {sections.map((section) => {
          const active = isSectionActive(pathname, section.href);
          const Icon = section.icon;
          return (
            <li key={section.id}>
              <Link
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-icon px-3.5 text-item transition-[transform,background-color] duration-150 ease-out select-none active:scale-[0.98]",
                  "hover:bg-sidebar-accent",
                  "[&_svg]:size-5 [&_svg]:shrink-0",
                  active
                    ? "bg-sidebar-accent font-bold text-sidebar-primary"
                    : "font-semibold text-sidebar-text",
                  sidebarFocusRing,
                )}
              >
                <Icon aria-hidden weight={active ? "fill" : "regular"} />
                <span className="min-w-0 truncate">{section.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

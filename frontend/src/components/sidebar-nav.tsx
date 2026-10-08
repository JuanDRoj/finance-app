"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_SECTIONS, isSectionActive } from "@/components/nav-sections";
import { sidebarFocusRing } from "@/components/ui/focus";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The sections of the app as icons (docs/diseno.md D17), inside the desktop sidebar. Each icon is
 * a link of 48 px with its `aria-label`, a tooltip with the same name (mouse hover and keyboard
 * focus, see `ui/tooltip.tsx`) and `aria-current="page"` when it is the current section. The
 * current one is also shown without relying on color: filled icon, a pill, and a bar at the left
 * edge (the icon's color change alone is 1.09:1). It is a Client Component for `usePathname`.
 */
export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Principal">
      <ul className="flex flex-col items-center gap-2">
        {NAV_SECTIONS.map((section) => {
          const active = isSectionActive(pathname, section.href);
          const Icon = section.icon;
          return (
            <li key={section.id} className="relative">
              {active ? (
                <span
                  aria-hidden
                  className="absolute top-1/2 -left-3 h-6 w-[3px] -translate-y-1/2 rounded-full bg-sidebar-primary"
                />
              ) : null}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Link
                      href={section.href}
                      aria-label={section.label}
                      aria-current={active ? "page" : undefined}
                    />
                  }
                  className={cn(
                    "flex size-12 items-center justify-center rounded-icon transition-[transform,background-color] duration-150 ease-out active:scale-[0.97]",
                    "hover:bg-sidebar-accent",
                    "[&_svg]:size-6 [&_svg]:shrink-0",
                    // The current section keeps its mint icon under the pointer too.
                    active
                      ? "bg-sidebar-accent text-sidebar-primary"
                      : "text-sidebar-foreground hover:text-sidebar-accent-foreground",
                    sidebarFocusRing,
                  )}
                >
                  <Icon aria-hidden weight={active ? "fill" : "regular"} />
                </TooltipTrigger>
                <TooltipContent>{section.label}</TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

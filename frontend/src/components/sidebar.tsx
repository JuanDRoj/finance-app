import Image from "next/image";
import { SidebarNav } from "@/components/sidebar-nav";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * The desktop sidebar (docs/diseno.md D17), as in the Kanza canvas: from 1024 px (`lg`) a floating
 * dark card, 76 px wide, with a 28 px radius, 16 px of air above, on the left and below, and the
 * logo and the sections inside. It follows the page while it scrolls (`sticky`, one viewport high
 * less that air). Below 1024 px it is `display: none`, so none of it takes focus or is read.
 *
 * It has no avatar: the avatar menu is in the header, at every width. Its bottom is empty until
 * Ayuda and Ajustes arrive (Hito 1, with the "+" button and the Pendientes counter).
 *
 * The card is inside a plain column that stretches with the page: a sticky card taller than the
 * page would otherwise make a short page scroll. The air above and below, and the left, grow with
 * `env(safe-area-inset-*)` (an iPad in landscape); the left one is the wrapper's padding, in
 * `AppShell`. A Server Component: the logo and the frame are plain HTML; `SidebarNav` is the
 * interactive island.
 */
export function Sidebar() {
  return (
    <div className="hidden lg:block lg:w-19 lg:shrink-0">
      <div className="sticky top-[max(1rem,env(safe-area-inset-top,0px))] flex h-[calc(100dvh-max(1rem,env(safe-area-inset-top,0px))-max(1rem,env(safe-area-inset-bottom,0px)))] flex-col items-center gap-2.5 rounded-tile border border-sidebar-border bg-sidebar px-3.5 py-4">
        {/* Not a link and with no visible text next to it, so it carries the name (D16 only uses
            `alt=""` when the name is already on screen). */}
        <Image
          src="/brand/kanza-icon.svg"
          alt="Kanza"
          width={44}
          height={44}
          className="mb-4.5 size-11"
        />
        <TooltipProvider>
          <SidebarNav />
        </TooltipProvider>
      </div>
    </div>
  );
}

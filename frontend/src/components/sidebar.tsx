import Image from "next/image";
import { SIDEBAR_CARD_POSITION } from "@/components/shell-layout";
import { SidebarNav } from "@/components/sidebar-nav";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The desktop sidebar (docs/diseno.md D17), as in the Kanza canvas: from 1024 px (`lg`) a floating
 * dark card, 76 px wide, with a 28 px radius, and the logo and the sections inside. It follows the
 * page while it scrolls (`sticky`, 16 px from the top). Below 1024 px it is `display: none`, so
 * none of it takes focus or is read.
 *
 * It has no avatar: the avatar menu is in the header, at every width. Its bottom is empty until
 * Ayuda and Ajustes arrive (Hito 1, with the "+" button and the Pendientes counter).
 *
 * Its height is a screen minus the padding of the group around it (16 px above, 24 px below, each
 * `max()` with the safe-area inset): see `shell-layout.ts`, which keeps both in step and has a test.
 * That makes a short page exactly one screen tall, so it does not scroll; the air under the card
 * is 24 px, as in the canvas. The card is inside a plain column that stretches with the page. The
 * left air grows with `env(safe-area-inset-left)` (an iPad in landscape) in the wrapper's padding,
 * in `AppShell`. A Server Component: the logo and the frame are plain HTML; `SidebarNav` is the
 * interactive island.
 */
export function Sidebar() {
  return (
    <div className="hidden lg:block lg:w-19 lg:shrink-0">
      <div
        className={cn(
          SIDEBAR_CARD_POSITION,
          "flex flex-col items-center gap-2.5 rounded-tile border border-sidebar-border bg-sidebar px-3.5 py-4",
        )}
      >
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

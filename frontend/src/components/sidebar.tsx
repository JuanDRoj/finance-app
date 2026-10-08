import Image from "next/image";
import { SidebarNav } from "@/components/sidebar-nav";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UserMenu, type UserMenuUser } from "@/components/user-menu";

type SidebarProps = {
  user?: UserMenuUser;
};

/**
 * The desktop sidebar (docs/diseno.md D17): from 1024 px (`lg`) a column of icons, 80 px wide,
 * solid and dark in both themes (`sidebar` tokens): logo on top, the sections, and the avatar menu
 * at the bottom. Below 1024 px it is `display: none`, so none of it takes focus or is read.
 *
 * It sticks to the left edge of the grid of `AppShell` (`sticky`, one viewport high) while the page
 * scrolls, and pads the notch and the home indicator with `env(safe-area-inset-*)`: on an iPad in
 * landscape the left inset belongs to the bar, not to the content. A Server Component: the logo
 * and the frame are plain HTML; `SidebarNav` and `UserMenu` are the interactive islands.
 */
export function Sidebar({ user }: SidebarProps) {
  return (
    <div className="hidden border-r border-sidebar-border bg-sidebar pt-[calc(1.25rem+env(safe-area-inset-top,0px))] pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] pl-[env(safe-area-inset-left,0px)] lg:sticky lg:top-0 lg:z-20 lg:flex lg:h-dvh lg:w-[calc(5rem+env(safe-area-inset-left,0px))] lg:flex-col lg:items-center lg:gap-6 lg:self-start">
      {/* Not a link and with no visible text next to it, so it carries the name (D16 only uses
          `alt=""` when the name is already on screen). */}
      <Image src="/brand/kanza-icon.svg" alt="Kanza" width={40} height={40} />
      <TooltipProvider>
        <SidebarNav />
        <div className="mt-auto">
          <UserMenu placement="sidebar" user={user} />
        </div>
      </TooltipProvider>
    </div>
  );
}

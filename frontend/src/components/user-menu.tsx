"use client";

import { CircleNotch, SignOut, User } from "@phosphor-icons/react/ssr";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { focusRing, sidebarFocusRing } from "@/components/ui/focus";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLogout } from "@/components/use-logout";
import { cn } from "@/lib/utils";

/** What the menu shows about the user. The server computes it (`AppShell`): only this crosses. */
export type UserMenuUser = {
  name: string;
  email: string;
  /** First letter of the name (`initialOf`), or `null`: then the avatar shows a person icon. */
  initial: string | null;
};

type UserMenuProps = {
  /** Without it (the screen could not load `/me`) the menu still offers "Cerrar sesión". */
  user?: UserMenuUser;
  /**
   * `header` (below 1024 px): light avatar on the glass header, the menu opens below it.
   * `sidebar` (from 1024 px): mint avatar on the dark bar with a tooltip, the menu opens to its
   * right. `AppShell` renders both and CSS shows one: `side` and `align` are props, so they
   * cannot change with the width.
   */
  placement: "header" | "sidebar";
  className?: string;
};

const ACCOUNT_LABEL = "Menú de la cuenta";

/**
 * The avatar and its menu (docs/diseno.md D17): the name and email of the user and "Cerrar
 * sesión", at every width. The logout is `useLogout` (KAN-27, full page load to `/login`); it is
 * called here and not in the menu item, so its busy state survives if the menu closes with Escape
 * while the request is pending. While it runs, the item stays in the menu with a spinner and
 * ignores presses (`closeOnClick={false}`); if it fails, a toast says so and the item is
 * available again.
 */
export function UserMenu({ user, placement, className }: UserMenuProps) {
  const { logout, busy } = useLogout();
  const inSidebar = placement === "sidebar";

  const avatar = (
    <DropdownMenuTrigger
      aria-label={ACCOUNT_LABEL}
      aria-busy={busy || undefined}
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-full transition-transform duration-150 ease-out active:scale-[0.97]",
        inSidebar ? sidebarFocusRing : focusRing,
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-10 items-center justify-center rounded-full font-heading text-base font-bold",
          inSidebar
            ? "bg-sidebar-primary text-sidebar-primary-foreground"
            : "bg-primary text-primary-foreground",
        )}
      >
        {user?.initial ?? <User weight="bold" className="size-5" />}
      </span>
    </DropdownMenuTrigger>
  );

  const logoutItem = (
    <DropdownMenuItem
      label="Cerrar sesión"
      closeOnClick={false}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={() => logout()}
    >
      {busy ? (
        <CircleNotch aria-hidden className="animate-spin motion-reduce:animate-none" />
      ) : (
        <SignOut aria-hidden />
      )}
      Cerrar sesión
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      {inSidebar ? (
        <Tooltip>
          <TooltipTrigger render={avatar} />
          <TooltipContent>{ACCOUNT_LABEL}</TooltipContent>
        </Tooltip>
      ) : (
        avatar
      )}
      <DropdownMenuContent side={inSidebar ? "right" : "bottom"} align="end">
        {user ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <span className="text-base font-bold">{user.name}</span>
              <span className="text-sm font-normal text-muted-foreground">{user.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {logoutItem}
          </DropdownMenuGroup>
        ) : (
          logoutItem
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

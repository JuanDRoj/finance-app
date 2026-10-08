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
import { focusRing } from "@/components/ui/focus";
import { useLogout } from "@/components/use-logout";
import { cn } from "@/lib/utils";

/** What the menu shows about the user. The server computes it (`AppShell`): only this crosses. */
export type UserMenuUser = {
  name: string;
  email: string;
  /** One or two letters of the name (`initialsOf`: "JD"), or `null`: then a person icon shows. */
  initials: string | null;
};

type UserMenuProps = {
  /** Without it (the screen could not load `/me`) the menu still offers "Cerrar sesión". */
  user?: UserMenuUser;
  className?: string;
};

const ACCOUNT_LABEL = "Menú de la cuenta";

/**
 * The avatar and its menu (docs/diseno.md D17): the name and email of the user and "Cerrar
 * sesión", at every width. It is the only one on the screen, in the header of `AppShell`: the
 * sidebar has no avatar (its bottom is for Ayuda and Ajustes, in Hito 1).
 *
 * The avatar follows the canvas: below 768 px a 44 px glass tile with the initials in `foreground`
 * (the `card-surface` of the bento tiles); from 768 px a 48 px circle in the soft green of the
 * secondary tokens (`primarySoft` / `onPrimarySoft` of the canvas).
 *
 * The logout is `useLogout` (KAN-27, full page load to `/login`). It is called here and not in the
 * menu item, so its busy state survives if the menu closes with Escape while the request is
 * pending. While it runs, the item stays in the menu with a spinner and ignores presses
 * (`closeOnClick={false}`); if it fails, a toast says so and the item is available again.
 */
export function UserMenu({ user, className }: UserMenuProps) {
  const { logout, busy } = useLogout();

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
      <DropdownMenuTrigger
        aria-label={ACCOUNT_LABEL}
        aria-busy={busy || undefined}
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full font-heading text-sm font-bold transition-transform duration-150 ease-out active:scale-[0.97]",
          "card-surface text-foreground",
          "md:size-12 md:border-0 md:bg-secondary md:text-[15px] md:text-secondary-foreground md:backdrop-blur-none",
          focusRing,
          className,
        )}
      >
        <span aria-hidden className="flex items-center justify-center">
          {user?.initials ?? <User weight="bold" className="size-5" />}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end">
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

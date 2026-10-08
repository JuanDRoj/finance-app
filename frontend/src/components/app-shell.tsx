import type { ReactNode } from "react";
import { BfcacheGuard } from "@/components/bfcache-guard";
import { Sidebar } from "@/components/sidebar";
import { UserMenu, type UserMenuUser } from "@/components/user-menu";
import type { UserRead } from "@/lib/core/data/me";
import { displayNameOf, initialsOf } from "@/lib/core/user";

type AppShellProps = {
  /** Screen title (the page's `h1`). */
  title: string;
  /**
   * Actions of this screen, on the right of the header and before the avatar (which the shell
   * always adds: no screen with a session can forget it).
   */
  actions?: ReactNode;
  /**
   * The logged-in user (`GET /me`), for the avatar and its menu. A page that could not load it
   * leaves it out: the avatar is then a generic icon and "Cerrar sesión" is still in its menu.
   */
  user?: Pick<UserRead, "display_name" | "email">;
  children: ReactNode;
};

/**
 * Frame of a signed-in screen (docs/diseno.md D17), after the Kanza canvas.
 *
 * - Below 1024 px: one centered column of 640 px at most, with 16 px gutters. Phones are narrower
 *   than that, so there it is just the screen.
 * - From 1024 px (`lg`): the sidebar (a floating card) and the content column are one group, up to
 *   1440 px wide **counting the bar**, centered. 16 px of padding above and on the left, 24 px on
 *   the right and below, and 24 px between the bar and the content.
 *
 * The header is flat, inside the content column and aligned with it (same width and gutters): the
 * `h1` on the left, the actions of the screen and the avatar menu (`UserMenu`) on the right, at
 * every width. The avatar is only there: the sidebar has none.
 *
 * The padding is the group's, so the header and the page can never disagree on their side
 * gutters. Each side is `max(gutter, env(safe-area-inset-*))`, not a sum: the inset is room the
 * screen already takes (a notch in landscape, `viewportFit: "cover"` in layout.tsx). It also
 * carries the decorative background (two static blobs) and the `BfcacheGuard` that keeps a
 * restored page from showing data after the logout (KAN-27). A Server Component: it holds no
 * state; it hands the client pieces only the name, the email and the initials.
 */
export function AppShell({ title, actions, user, children }: AppShellProps) {
  const menuUser: UserMenuUser | undefined = user && {
    name: displayNameOf(user),
    email: user.email,
    initials: initialsOf(user),
  };

  return (
    <div className="relative isolate min-h-dvh overflow-x-clip">
      {/* Decorative: at most two per screen (docs/diseno.md D13). */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-20 -z-10 size-72 rounded-full bg-blob-1 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-96 -left-24 -z-10 size-72 rounded-full bg-blob-2 blur-3xl"
      />
      <div className="relative mx-auto w-full max-w-160 pr-[max(1rem,env(safe-area-inset-right,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))] lg:flex lg:max-w-360 lg:items-stretch lg:gap-6 lg:pt-[max(1rem,env(safe-area-inset-top,0px))] lg:pr-[max(1.5rem,env(safe-area-inset-right,0px))] lg:pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]">
        <Sidebar />
        {/* `min-w-0`: a flex item is as wide as its widest content by default, and a long word
            would widen the column past the screen instead of wrapping. */}
        <div className="min-w-0 lg:flex-1">
          <header className="flex items-center justify-between gap-3 pt-[calc(1.125rem+env(safe-area-inset-top,0px))] pb-3 lg:pt-2 lg:pb-0">
            <h1 className="line-clamp-2 min-w-0 font-heading text-2xl leading-tight font-bold tracking-[-0.02em] break-words md:text-[26px] lg:text-[30px]">
              {title}
            </h1>
            <div className="flex shrink-0 items-center gap-2.5">
              {actions}
              <UserMenu user={menuUser} />
            </div>
          </header>
          <BfcacheGuard />
          <main className="relative pt-2 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] lg:pt-5 lg:pb-0">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

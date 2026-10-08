import type { ReactNode } from "react";
import { BfcacheGuard } from "@/components/bfcache-guard";
import { Sidebar } from "@/components/sidebar";
import { UserMenu, type UserMenuUser } from "@/components/user-menu";
import type { UserRead } from "@/lib/core/data/me";
import { displayNameOf, initialOf } from "@/lib/core/user";
import { cn } from "@/lib/utils";

type AppShellProps = {
  /** Screen title (the page's `h1`). */
  title: string;
  /**
   * Actions of this screen, on the right of the header and before the avatar (which the shell
   * always adds on screens narrower than 1024 px: no screen with a session can forget it).
   */
  actions?: ReactNode;
  /**
   * The logged-in user (`GET /me`), for the avatar and its menu. A page that could not load it
   * leaves it out: the avatar is then a generic icon and "Cerrar sesión" is still in its menu.
   */
  user?: Pick<UserRead, "display_name" | "email">;
  children: ReactNode;
};

// One width for the header and the page, so that the title lines up with the content: a phone
// column up to 640 px (tablet), and from 1024 px the content grows up to 1440 px.
const CONTENT_WIDTH = "mx-auto w-full max-w-160 lg:max-w-360";

/**
 * Frame of a signed-in screen (docs/diseno.md D17).
 *
 * - Below 1024 px: sticky `glass` header (title, actions and the avatar menu) over a centered
 *   column of 640 px at most; 448 px and less on a phone is just the screen width.
 * - From 1024 px (`lg`): the dark `Sidebar` on the left (logo, sections, avatar menu) and, to its
 *   right, the same header (without the avatar, which is in the bar) over a content area up to
 *   1440 px wide. The cap counts the content only; the bar stays at the left edge.
 *
 * It also carries the decorative background (two static blobs), pads the notch, the home
 * indicator and the sides with `env(safe-area-inset-*)` (`viewportFit: "cover"` in layout.tsx), and
 * the `BfcacheGuard` that keeps a restored page from showing data after the logout (KAN-27).
 * "Cerrar sesión" is in the avatar menu (`UserMenu`). A Server Component: it holds no state; it
 * hands the client pieces only the name, the email and the initial.
 */
export function AppShell({ title, actions, user, children }: AppShellProps) {
  const menuUser: UserMenuUser | undefined = user && {
    name: displayNameOf(user),
    email: user.email,
    initial: initialOf(user),
  };

  return (
    <div className="relative isolate min-h-dvh overflow-x-clip lg:grid lg:grid-cols-[auto_1fr]">
      {/* Decorative: at most two per screen (docs/diseno.md D13). */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-20 -z-10 size-72 rounded-full bg-blob-1 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-96 -left-24 -z-10 size-72 rounded-full bg-blob-2 blur-3xl"
      />
      <Sidebar user={menuUser} />
      {/* `min-w-0`: a grid item is as wide as its widest content by default, and a long word
          would widen the column past the screen instead of wrapping. */}
      <div className="min-w-0">
        <header className="glass sticky top-0 z-10 rounded-none border-x-0! border-t-0! pt-[env(safe-area-inset-top,0px)] pr-[env(safe-area-inset-right,0px)] pl-[env(safe-area-inset-left,0px)] lg:pl-0">
          <div
            className={cn(
              CONTENT_WIDTH,
              "flex min-h-14 items-center justify-between gap-3 px-4 py-2 lg:px-8",
            )}
          >
            <h1 className="line-clamp-2 min-w-0 font-heading text-xl leading-tight font-bold break-words">
              {title}
            </h1>
            <div className="flex shrink-0 items-center gap-2">
              {actions}
              <UserMenu placement="header" user={menuUser} className="lg:hidden" />
            </div>
          </div>
        </header>
        <BfcacheGuard />
        <main
          className={cn(
            CONTENT_WIDTH,
            "relative pt-6 pr-[max(1rem,env(safe-area-inset-right,0px))] pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))] lg:pr-[max(2rem,env(safe-area-inset-right,0px))] lg:pl-8",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

import type { ReactNode } from "react";
import { BfcacheGuard } from "@/components/bfcache-guard";
import { LogoutButton } from "@/components/logout-button";

type AppShellProps = {
  /** Screen title (the page's `h1`). */
  title: string;
  /**
   * Actions of this screen, on the right of the header and before "Cerrar sesión" (which the
   * shell always adds: no screen with a session can forget it).
   */
  actions?: ReactNode;
  children: ReactNode;
};

/**
 * Frame of a signed-in screen: sticky `glass` header (title + actions), a column that is 448 px
 * wide at most, and the decorative background (two static blobs). It pads the notch, the home
 * indicator and the sides with `env(safe-area-inset-*)` (`viewportFit: "cover"` in layout.tsx).
 * It always carries "Cerrar sesión" (`LogoutButton`) and the `BfcacheGuard` that keeps a restored
 * page from showing data after the logout (KAN-27). A Server Component: it holds no state.
 */
export function AppShell({ title, actions, children }: AppShellProps) {
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
      <header className="glass sticky top-0 z-10 rounded-none border-x-0! border-t-0! pt-[env(safe-area-inset-top,0px)] pr-[env(safe-area-inset-right,0px)] pl-[env(safe-area-inset-left,0px)]">
        <div className="mx-auto flex min-h-14 max-w-md items-center justify-between gap-3 px-4 py-2">
          <h1 className="line-clamp-2 min-w-0 font-heading text-xl leading-tight font-bold break-words">
            {title}
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <LogoutButton />
          </div>
        </div>
      </header>
      <BfcacheGuard />
      <main className="relative mx-auto w-full max-w-md pt-6 pr-[max(1rem,env(safe-area-inset-right,0px))] pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))]">
        {children}
      </main>
    </div>
  );
}

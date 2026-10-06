import type { ReactNode } from "react";

type AppShellProps = {
  /** Screen title (the page's `h1`). */
  title: string;
  /**
   * Right side of the header. The "Cerrar sesión" button goes here (it is a client component
   * that calls `DELETE /api/auth/session`; KAN-27).
   */
  actions?: ReactNode;
  children: ReactNode;
};

/**
 * Frame of a signed-in screen: sticky `glass` header (title + actions), a column that is 448 px
 * wide at most, and the decorative background (two static blobs). It pads the notch, the home
 * indicator and the sides with `env(safe-area-inset-*)` (`viewportFit: "cover"` in layout.tsx).
 * A Server Component: it holds no state.
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
        <div className="mx-auto flex min-h-14 max-w-md items-center justify-between gap-3 px-4">
          <h1 className="min-w-0 truncate font-heading text-xl font-bold">{title}</h1>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      </header>
      <main className="relative mx-auto w-full max-w-md pt-6 pr-[max(1rem,env(safe-area-inset-right,0px))] pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))]">
        {children}
      </main>
    </div>
  );
}

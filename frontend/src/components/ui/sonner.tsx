"use client";

import { CheckCircle, Info, Warning, XCircle, CircleNotch } from "@phosphor-icons/react/ssr";
import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// Above the bottom edge and the home indicator. The bottom nav (a later task) will raise it.
const OFFSET = "calc(16px + env(safe-area-inset-bottom, 0px))";

/**
 * The one `<Toaster />` of the app (mounted in layout.tsx); call `toast()` from client code only.
 * A toast is floating chrome: it uses the `glass` surface (docs/diseno.md D8, D13).
 * 6 s by default so the "Deshacer" action can be reached.
 */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="system"
      position="bottom-center"
      duration={6000}
      offset={{ bottom: OFFSET, left: 16, right: 16 }}
      mobileOffset={{ bottom: OFFSET, left: 16, right: 16 }}
      icons={{
        success: <CheckCircle aria-hidden className="size-5" />,
        info: <Info aria-hidden className="size-5" />,
        warning: <Warning aria-hidden className="size-5" />,
        error: <XCircle aria-hidden className="size-5" />,
        loading: (
          <CircleNotch aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
        ),
      }}
      style={
        {
          // Sonner's own CSS is unlayered, so it wins over utilities: set its variables instead.
          "--normal-bg": "var(--glass)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--glass-border)",
          "--border-radius": "var(--radius-field)",
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "glass font-sans",
          // `!` (important) because Sonner's unlayered styles would otherwise override these (they also
          // remove the outline and draw a faint box-shadow on focus: the project's ring, focus.ts, replaces it).
          actionButton:
            "h-11! rounded-full! bg-primary! px-4! text-sm! font-semibold! text-primary-foreground! focus-visible:outline-solid! focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!",
        },
      }}
      {...props}
    />
  );
}

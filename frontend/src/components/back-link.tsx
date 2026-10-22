"use client";

import { CaretLeft } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { canGoBackInApp } from "@/components/back-navigation";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

type BackLinkProps = {
  /** Where "Volver" goes when there is nothing in this app to go back to (the page was opened directly). */
  fallbackHref?: string;
  className?: string;
};

/**
 * The "Volver" of a screen with a form (docs/diseno.md D18): a 44 px round arrow before the title.
 * It goes back in the history when the visitor came from this app, so they land where they were
 * (the Inicio, later Cuentas); opened directly, it is a plain link to `fallbackHref`. It is a real
 * link, so it also works with no JavaScript and in a new tab.
 */
export function BackLink({ fallbackHref = "/", className }: BackLinkProps) {
  const router = useRouter();
  return (
    <Link
      href={fallbackHref}
      aria-label="Volver"
      onClick={(event) => {
        if (!canGoBackInApp()) return;
        event.preventDefault();
        router.back();
      }}
      className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "shrink-0", className)}
    >
      <CaretLeft aria-hidden className="size-5.5" />
    </Link>
  );
}

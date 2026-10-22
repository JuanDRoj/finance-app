"use client";

import { useRouter } from "next/navigation";
import { AccountForm } from "@/components/accounts/account-form";
import { canGoBackInApp } from "@/components/back-navigation";
import type { Currency } from "@/lib/core/money";

/**
 * The form of `/cuentas/nueva` (below 1024 px): `AccountForm` in its page variant, and back to where
 * the person was once the account exists (the Inicio, later Cuentas).
 *
 * - **Came from the app** (`canGoBackInApp`, the rule of "Volver"): `router.back()`. The history
 *   goes back to `[/]` instead of growing to `[/, /]`, and "atrás" does not return to a form that
 *   already did its job. The page behind was cached with the first-use screen, and Next.js reuses a
 *   cached page on back/forward whatever its age, so `router.refresh()` goes first: it bumps the
 *   version of that cache (`invalidateBfCache`, in `refreshReducer`), which makes the entry behind
 *   unusable, and going back then asks the server for the Inicio again. The person never sees the
 *   stale one, and the server renders the Inicio once.
 * - **Opened directly** (nothing in this app to go back to): `router.replace("/")`. That is a
 *   regular navigation to a dynamic page, which Next.js never serves from its cache
 *   (`staleTimes.dynamic` is 0), so it is fresh as it is and needs no refresh.
 */
export function NewAccountPageForm({
  space,
}: Readonly<{ space: { id: string; currency: Currency } }>) {
  const router = useRouter();

  function leave() {
    if (canGoBackInApp()) {
      router.refresh();
      router.back();
    } else {
      router.replace("/");
    }
  }

  return <AccountForm variant="page" space={space} onDone={leave} />;
}

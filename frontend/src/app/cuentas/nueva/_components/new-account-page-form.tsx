"use client";

import { useRouter } from "next/navigation";
import { AccountForm } from "@/components/accounts/account-form";
import type { Currency } from "@/lib/core/money";

/**
 * The form of `/cuentas/nueva` (below 1024 px): `AccountForm` in its page variant, and "Inicio" once
 * the account exists. `replace`, not `push`: the page of the form leaves the history, so "atrás"
 * from the Inicio does not come back to a form that already did its job. The Inicio is where the
 * person started and, until Cuentas exists (FE-17), where they see the account they created.
 */
export function NewAccountPageForm({
  space,
}: Readonly<{ space: { id: string; currency: Currency } }>) {
  const router = useRouter();
  return <AccountForm variant="page" space={space} onDone={() => router.replace("/")} />;
}

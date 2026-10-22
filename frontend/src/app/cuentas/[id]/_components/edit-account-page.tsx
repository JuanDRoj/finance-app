"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AccountEditForm } from "@/components/accounts/account-edit-form";
import { ReconcileForm } from "@/components/accounts/reconcile-form";
import { canGoBackInApp } from "@/components/back-navigation";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import type { Currency } from "@/lib/core/money";

/**
 * Where the focus starts in the reconcile sheet: the amount. Explicit, because the alert of archiving
 * that opens this sheet from its "Cuadrar saldo" closes in the same tick and must not take the focus
 * back to the row behind (see `ArchiveBlocked`).
 */
function amountField(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    "[data-slot='sheet-content'] input[inputmode='decimal']",
  );
}

/**
 * The body of `/cuentas/[id]` (below 1024 px): the edit form in its page variant, with the group
 * "Más acciones" under it, and "Cuadrar saldo" as a bottom sheet over the page (docs/diseno.md D18).
 *
 * - The sheet opens from "Cuadrar saldo" (local state) or from `?cuenta=cuadrar` (a link from the
 *   desktop panel, read once when the page opens). After matching the balance it closes and the
 *   page stays on the form, with the server data refreshed. The alert of archiving is a bottom sheet
 *   too (`ArchiveBlocked`), and its "Cuadrar saldo" opens this one.
 * - Leaving after saving, or after archiving, works like `/cuentas/nueva` (see its form): came from
 *   the app, `router.refresh()` and then `router.back()` (the page behind was cached and Next reuses
 *   it on back/forward); opened directly, `router.replace("/cuentas")`.
 */
export function EditAccountPage({
  account,
  space,
}: Readonly<{ account: AccountWithBalance; space: { id: string; currency: Currency } }>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [reconcileOpen, setReconcileOpen] = useState(
    () => searchParams.get("cuenta") === "cuadrar",
  );

  function leave() {
    if (canGoBackInApp()) {
      router.refresh();
      router.back();
    } else {
      router.replace("/cuentas");
    }
  }

  return (
    <>
      <AccountEditForm
        account={account}
        space={space}
        variant="page"
        onDone={leave}
        onArchived={leave}
        onReconcile={() => setReconcileOpen(true)}
      />
      <Sheet open={reconcileOpen} onOpenChange={setReconcileOpen}>
        <SheetContent side="bottom" initialFocus={amountField}>
          <SheetHeader showClose={false}>
            <SheetTitle className="text-xl">Cuadrar saldo</SheetTitle>
          </SheetHeader>
          <ReconcileForm
            account={account}
            space={space}
            variant="sheet"
            onDone={() => {
              setReconcileOpen(false);
              router.refresh();
            }}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

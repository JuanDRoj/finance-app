"use client";

import { useEffect, useRef } from "react";
import { WarningCircle } from "@phosphor-icons/react/ssr";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useIsDesktop } from "@/components/use-is-desktop";
import { displayedAmount } from "@/lib/core/accounts-summary";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import { formatMoney, type Currency } from "@/lib/core/money";

type ArchiveBlockedProps = {
  account: AccountWithBalance;
  currency: Currency;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Cuadrar saldo": the caller shows the reconcile view of this account. */
  onReconcile: () => void;
};

/**
 * "Todavía no puedes archivar {nombre}" (docs/diseno.md D18, K-V2-NoArchivar and K-H1-NoArchivar):
 * the `alertdialog` that opens when the backend refuses to archive an account whose balance is not
 * zero. It says why, with today's balance, and what to do: pass the money to another account with a
 * transfer or, if the account is not used any more, reconcile its balance to zero. Centered card of
 * 460 px from 1024 px and bottom sheet below. "Entendido" on the left, "Cuadrar saldo" (the action)
 * on the right. Amounts come from `formatMoney` with the space's currency.
 */
export function ArchiveBlocked({
  account,
  currency,
  open,
  onOpenChange,
  onReconcile,
}: ArchiveBlockedProps) {
  const desktop = useIsDesktop();
  // "Cuadrar saldo" opens the next view (a panel view or a bottom sheet) in the same tick as this one
  // closes. Closing a dialog gives the focus back to what had it before (the "Archivar cuenta" row,
  // behind the new view): on that exit path alone the focus is left to the view that opens.
  const toReconcile = useRef(false);
  useEffect(() => {
    if (open) toReconcile.current = false;
  }, [open]);
  const zero = formatMoney(0, currency);
  const isCard = account.type === "credit_card";
  // A card normally owes (negative balance); one paid in excess has a positive balance, a credit in
  // its favor, and "debes −$ 10" would be nonsense (docs/diseno.md D18).
  const inFavor = isCard && account.balance_minor > 0;
  const today = formatMoney(inFavor ? account.balance_minor : displayedAmount(account), currency);
  let state = `Hoy tiene ${today}.`;
  if (inFavor) state = `Hoy tienes ${today} a favor en esta tarjeta.`;
  else if (isCard) state = `Hoy debes ${today} en esta tarjeta.`;
  const reason = `Para archivar una cuenta, su saldo tiene que ser ${zero}. ${state}`;
  let way = `Pasa el dinero a otra cuenta con una transferencia o, si ya no la usas, cuadra su saldo en ${zero}.`;
  if (inFavor) {
    way = `Usa ese saldo en tus compras o, si ya no la usas, cuadra su saldo en ${zero}.`;
  } else if (isCard) {
    way = `Págala con una transferencia o, si ya no la usas, cuadra su saldo en ${zero}.`;
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        placement={desktop ? "center" : "bottom"}
        finalFocus={() => !toReconcile.current}
      >
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-debt/10 text-debt dark:bg-debt/14"
        >
          <WarningCircle weight="duotone" className="size-6" />
        </span>
        <div className="flex min-w-0 flex-col gap-2">
          <AlertDialogTitle>Todavía no puedes archivar {account.name}</AlertDialogTitle>
          <AlertDialogDescription className="flex flex-col gap-2">
            <span>{reason}</span>
            <span>{way}</span>
          </AlertDialogDescription>
        </div>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" size="sm" />}>
            Entendido
          </AlertDialogClose>
          <Button
            size="sm"
            onClick={() => {
              toReconcile.current = true;
              onReconcile();
            }}
          >
            Cuadrar saldo
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

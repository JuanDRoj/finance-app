"use client";

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
  const zero = formatMoney(0, currency);
  const isCard = account.type === "credit_card";
  const today = formatMoney(displayedAmount(account), currency);
  const reason = `Para archivar una cuenta, su saldo tiene que ser ${zero}. ${
    isCard ? `Hoy debes ${today} en esta tarjeta.` : `Hoy tiene ${today}.`
  }`;
  const way = isCard
    ? `Págala con una transferencia o, si ya no la usas, cuadra su saldo en ${zero}.`
    : `Pasa el dinero a otra cuenta con una transferencia o, si ya no la usas, cuadra su saldo en ${zero}.`;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent placement={desktop ? "center" : "bottom"}>
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
          <Button size="sm" onClick={onReconcile}>
            Cuadrar saldo
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

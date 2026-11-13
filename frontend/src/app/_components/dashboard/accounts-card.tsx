"use client";

import Link from "next/link";
import { useId } from "react";
import { AccountIcon } from "@/components/accounts/account-icon";
import { AccountLink } from "@/components/accounts/account-link";
import { Card } from "@/components/ui/card";
import { focusRing } from "@/components/ui/focus";
import { formatDashboardAmount, pickHomeAccounts } from "@/lib/core/dashboard";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import type { Currency } from "@/lib/core/money";
import { cn } from "@/lib/utils";
import { AccountRowsSkeleton, InlineError } from "./dashboard-states";
import type { Load } from "./use-dashboard-data";

/**
 * "Cuentas", the compact list of the Inicio (FE-24, KAN-84; K-V2-Escritorio, docs/diseno.md D17 ›
 * Escritorio v2; it replaces "Tus cuentas" of FE-16). From 1024 px only (`max-lg:hidden`). The
 * first 8 active accounts (`pickHomeAccounts`), each a row of 50 px: the icon of its type (36 px), its
 * name (cut with "…") and its amount; a card is shown by what it owes, positive and in the debt
 * color, as Cuentas does. There is no line under the name (the canvas draws none). The title has
 * "Ver cuentas" to `/cuentas`, always there; a row is an `AccountLink`, which from 1024 px goes to
 * `/cuentas?sel=<id>` with that account in the detail.
 */
export function AccountsCard({
  accounts,
  currency,
  className,
}: Readonly<{ accounts: Load<AccountWithBalance[]>; currency: Currency; className?: string }>) {
  const titleId = useId();
  const rows = accounts.data ? pickHomeAccounts(accounts.data).rows : undefined;
  return (
    <Card
      variant="tile"
      role="region"
      aria-labelledby={titleId}
      aria-busy={!rows && !accounts.failed ? true : undefined}
      className={cn("max-lg:hidden lg:gap-1.5 lg:px-6 lg:py-5.5", className)}
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <h2 id={titleId} className="font-heading text-card-title font-bold">
          Cuentas
        </h2>
        <Link
          href="/cuentas"
          prefetch={false}
          className={cn(
            "inline-flex min-h-9 items-center rounded-sm text-sm font-bold text-primary hover:underline pointer-coarse:min-h-11",
            focusRing,
          )}
        >
          Ver cuentas
        </Link>
      </div>
      {accounts.failed ? (
        <InlineError
          title="No se pudieron cargar tus cuentas"
          error={accounts.error}
          onRetry={accounts.retry}
          busy={accounts.busy}
        />
      ) : !rows ? (
        <AccountRowsSkeleton />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((account) => {
            const isCard = account.type === "credit_card";
            // The debt is the opposite of the balance: an integer negation (never "-0").
            const amount = isCard ? 0 - account.balance_minor : account.balance_minor;
            return (
              <li key={account.id}>
                <AccountLink
                  accountId={account.id}
                  className={cn(
                    "-mx-2 flex min-h-12.5 items-center gap-3 rounded-xl px-2 py-1 hover:bg-primary-soft",
                    focusRing,
                  )}
                >
                  <AccountIcon type={account.type} size="sm" />
                  <span
                    title={account.name}
                    className="min-w-16 flex-1 truncate text-item font-bold"
                  >
                    {account.name}
                  </span>
                  <span
                    className={cn(
                      "text-right font-heading text-item font-semibold tabular-nums wrap-anywhere",
                      isCard && "text-debt",
                    )}
                  >
                    {formatDashboardAmount(amount, currency)}
                  </span>
                </AccountLink>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

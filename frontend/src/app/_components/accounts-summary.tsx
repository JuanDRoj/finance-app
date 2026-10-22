import Link from "next/link";
import { AccountIcon } from "@/components/accounts/account-icon";
import { focusRing } from "@/components/ui/focus";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import { accountMetaLine } from "@/lib/core/accounts-summary";
import { formatMoney, type Currency } from "@/lib/core/money";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * "Tus cuentas": what the Inicio shows once the space has accounts, until the real dashboard (FE-24)
 * takes its place; it is the first version of that dashboard's "Cuentas" card. Each row is the icon
 * of its type, the name (cut with "…" if it does not fit), its secondary line and its amount. A
 * card is shown by what it owes, positive and in the debt color, as the Inicio will show it
 * (`balance_minor` is negative when you owe); the others by their balance. Each row is a link to
 * `/cuentas?sel=<id>` (FE-17): the Cuentas screen, with that account in the detail from 1024 px. On
 * a phone it is the list, which is where a tap on an account can lead until its page exists (FE-28).
 */
export function AccountsSummary({
  accounts,
  currency,
}: Readonly<{ accounts: readonly AccountWithBalance[]; currency: Currency }>) {
  return (
    <Card variant="tile" aria-labelledby="accounts-summary-title" role="region" className="flex-1">
      <CardTitle id="accounts-summary-title" className="text-item font-bold text-muted-foreground">
        Tus cuentas
      </CardTitle>
      <ul className="flex flex-col gap-0.5">
        {accounts.map((account) => {
          const isCard = account.type === "credit_card";
          // The debt is the opposite of the balance: an integer negation, no floats involved.
          const amount = isCard ? -account.balance_minor : account.balance_minor;
          return (
            <li key={account.id}>
              <Link
                href={`/cuentas?sel=${account.id}`}
                prefetch={false}
                className={cn(
                  "-mx-2 flex min-h-13.5 items-center gap-3 rounded-xl px-2 py-1 hover:bg-primary-soft",
                  focusRing,
                )}
              >
                <AccountIcon type={account.type} size="sm" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-item font-bold" title={account.name}>
                    {account.name}
                  </span>
                  <span className="truncate text-caption text-muted-foreground">
                    {accountMetaLine(account)}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 font-heading text-item font-semibold tabular-nums",
                    isCard && "text-debt",
                  )}
                >
                  {formatMoney(amount, currency)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

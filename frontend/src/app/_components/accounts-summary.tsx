import { Bank, CreditCard, Money } from "@phosphor-icons/react/ssr";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import { describeAccountType } from "@/lib/core/i18n";
import { formatMoney, type Currency } from "@/lib/core/money";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const ICON_OF_TYPE = { bank: Bank, cash: Money, credit_card: CreditCard } as const;

/**
 * The small line under the name: the type of the account, or for a card the days it closes and
 * is due ("Cierra el 5 · vence el 12", docs/diseno.md D18).
 */
function secondaryLine(account: AccountWithBalance): string {
  if (account.type === "credit_card" && account.closing_day && account.due_day) {
    return `Cierra el ${account.closing_day} · vence el ${account.due_day}`;
  }
  return describeAccountType(account.type);
}

/**
 * "Tus cuentas": what the Inicio shows once the space has accounts, until the real dashboard (FE-24)
 * takes its place; it is the first version of that dashboard's "Cuentas" card. Each row is the icon
 * of its type, the name (cut with "…" if it does not fit), its secondary line and its amount. A
 * card is shown by what it owes, positive and in the debt color, as the Inicio will show it
 * (`balance_minor` is negative when you owe); the others by their balance. No row is a link: the
 * Cuentas screen (FE-17) does not exist yet.
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
          const Icon = ICON_OF_TYPE[account.type];
          const isCard = account.type === "credit_card";
          // The debt is the opposite of the balance: an integer negation, no floats involved.
          const amount = isCard ? -account.balance_minor : account.balance_minor;
          return (
            <li key={account.id} className="flex min-h-13.5 items-center gap-3 py-1">
              <span
                aria-hidden
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-xl",
                  isCard ? "bg-debt/10 text-debt dark:bg-debt/14" : "bg-primary-soft text-primary",
                )}
              >
                <Icon weight="duotone" className="size-4.5" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-item font-bold">{account.name}</span>
                <span className="truncate text-caption text-muted-foreground">
                  {secondaryLine(account)}
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
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

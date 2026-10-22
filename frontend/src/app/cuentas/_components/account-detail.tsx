import { AccountIcon } from "@/components/accounts/account-icon";
import { Card } from "@/components/ui/card";
import { displayedAmount } from "@/lib/core/accounts-summary";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import { describeAccountType } from "@/lib/core/i18n";
import { formatMoney, type Currency } from "@/lib/core/money";
import { cn } from "@/lib/utils";

/** "Tarjeta · cierra el 5 · vence el 12", or just "Banco" / "Efectivo" (K-V2 `metaLarga`). */
function longMeta(account: AccountWithBalance): string {
  const type = describeAccountType(account.type);
  if (account.type === "credit_card" && account.closing_day && account.due_day) {
    return `${type} · cierra el ${account.closing_day} · vence el ${account.due_day}`;
  }
  return type;
}

/**
 * The detail of the chosen account, from 1024 px (docs/diseno.md D17 › Escritorio v2, D18): the
 * icon, the name, the type (and a card's days) and today's balance, or today's debt for a card, in
 * the debt color. Hidden below 1024 px, where tapping an account will open its page (FE-28).
 *
 * Only the header for now: "Cuadrar saldo" and "Editar" arrive with KAN-92 (FE-28), and the month
 * figure and the table of movements with KAN-89 (FE-26), which needs the movements endpoint. No
 * placeholder stands in for them. The name wraps in two lines at most (the whole name in `title`);
 * the amount breaks anywhere rather than overflowing (the cap is 9.007.199.254.740.991 units).
 */
export function AccountDetail({
  account,
  currency,
}: Readonly<{ account: AccountWithBalance; currency: Currency }>) {
  const isCard = account.type === "credit_card";
  return (
    <Card
      variant="tile"
      role="region"
      aria-labelledby="account-detail-title"
      className="hidden gap-5 lg:flex lg:p-5.5"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <AccountIcon type={account.type} size="lg" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2
              id="account-detail-title"
              title={account.name}
              className="line-clamp-2 font-heading text-panel-title leading-tight font-bold break-words"
            >
              {account.name}
            </h2>
            <span className="text-sm break-words text-muted-foreground">{longMeta(account)}</span>
          </div>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-bold text-muted-foreground">
          {isCard ? "Deuda de hoy" : "Saldo de hoy"}
        </span>
        <span
          className={cn(
            "font-heading text-3xl font-semibold tracking-title break-all tabular-nums",
            isCard && "text-debt",
          )}
        >
          {formatMoney(displayedAmount(account), currency)}
        </span>
      </div>
    </Card>
  );
}

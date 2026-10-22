import { useId } from "react";
import { formatMoney, type Currency } from "@/lib/core/money";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import { cn } from "@/lib/utils";
import { AccountRow } from "./account-row";

type AccountGroupProps = {
  title: string;
  /** The group's total in the minor unit, from `summarizeAccounts`. */
  total: bigint;
  /** Deuda: the total and the amounts are in the debt color. */
  debt?: boolean;
  accounts: readonly AccountWithBalance[];
  currency: Currency;
  selectedId: string | undefined;
};

/**
 * "Disponible" (banks and cash) or "Deuda" (cards): the title with the group's total on the right,
 * and one row per account (docs/diseno.md D18). A glass list below 1024 px and a solid card from
 * there. One under the other at every width; from 1024 px they make the left column of the screen.
 */
export function AccountGroup({
  title,
  total,
  debt = false,
  accounts,
  currency,
  selectedId,
}: AccountGroupProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 px-1 lg:px-4">
        <h2
          id={titleId}
          className="font-heading text-base font-bold lg:text-sm lg:text-muted-foreground"
        >
          {title}
        </h2>
        <span
          className={cn(
            "min-w-0 text-right font-heading text-item font-semibold break-all tabular-nums",
            debt && "text-debt",
          )}
        >
          {formatMoney(total, currency)}
        </span>
      </div>
      <ul className="tile-surface flex flex-col overflow-hidden rounded-tile lg:rounded-card lg:p-2.5">
        {accounts.map((account, index) => (
          <li
            key={account.id}
            className={cn("min-w-0", index > 0 && "border-t border-border lg:border-t-0")}
          >
            <AccountRow
              account={account}
              currency={currency}
              selected={account.id === selectedId}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

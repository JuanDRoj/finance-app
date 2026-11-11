"use client";

import { PencilSimple, Scales } from "@phosphor-icons/react/ssr";
import { AccountIcon } from "@/components/accounts/account-icon";
import { openAccountPanelInUrl } from "@/components/accounts/panel-url";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useIsDesktop } from "@/components/use-is-desktop";
import { useMovementFilters } from "@/app/movimientos/_components/use-movement-filters";
import { browserApi } from "@/lib/api/browser";
import { displayedAmount } from "@/lib/core/accounts-summary";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import type { ApiClient } from "@/lib/core/data/api-client";
import { describeAccountType } from "@/lib/core/i18n";
import { formatMoney, type Currency } from "@/lib/core/money";
import { cn } from "@/lib/utils";
import { AccountMonthFigure } from "./account-month-figure";
import { AccountMovements } from "./account-movements";

/** "Tarjeta · cierra el 5 · vence el 12", or just "Banco" / "Efectivo" (K-V2 `metaLarga`). */
function longMeta(account: AccountWithBalance): string {
  const type = describeAccountType(account.type);
  if (account.type === "credit_card" && account.closing_day && account.due_day) {
    return `${type} · cierra el ${account.closing_day} · vence el ${account.due_day}`;
  }
  return type;
}

/**
 * The detail of the chosen account, from 1024 px (docs/diseno.md D17 › Escritorio v2, D18;
 * K-V2-Escritorio, "cuentas"): the icon, the name, the type (and a card's days), today's balance, or
 * today's debt for a card, in the debt color, **the figure of the month** next to it ("Movimiento neto
 * de octubre" or "Consumos de octubre", `AccountMonthFigure`) and **the table of the account's
 * movements** with the balance after each one (`AccountMovements`, FE-26 / KAN-89). Hidden below
 * 1024 px, where tapping an account opens its page (`/cuentas/[id]`).
 *
 * "Cuadrar saldo" and "Editar" open the side panels of the account over the list (`?cuenta=cuadrar` /
 * `?cuenta=editar`, with `?sel=<id>` of this account: the detail may be showing the first one by
 * default). The name wraps in two lines at most (the whole name in `title`); the amount breaks
 * anywhere rather than overflowing (the cap is 9.007.199.254.740.991 units).
 *
 * - **The month and the type** are `?mes=` and `?tipo=` of the URL, read once here (`useMovementFilters`
 *   of Movimientos) and handed down: the figure takes the month, the table the month and the type.
 * - **Requests only from 1024 px** (`useIsDesktop`, `false` on the server and while hydrating): the
 *   detail is rendered on a phone too, hidden by CSS, and asking for 50 movements nobody sees would
 *   be a waste. The data is not prefetched on the server for the same reason.
 * - The screen gives it a `key` per account, so nothing of the previous account stays on show.
 */
export function AccountDetail({
  account,
  space,
  currentMonth,
  today,
  api = browserApi,
}: Readonly<{
  account: AccountWithBalance;
  space: { id: string; currency: Currency };
  /** The current month (`YYYY-MM`) and day of the space's zone, computed by the server page. */
  currentMonth: string;
  today: string;
  /** The API client; the browser's by default (the catalog and the tests pass a scripted one). */
  api?: ApiClient;
}>) {
  const isCard = account.type === "credit_card";
  const isDesktop = useIsDesktop();
  const { filters, setFilters } = useMovementFilters(currentMonth);
  return (
    <Card
      variant="tile"
      role="region"
      aria-labelledby="account-detail-title"
      className="hidden gap-4.5 lg:flex lg:p-5.5"
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
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="lg:min-h-10 lg:pointer-coarse:min-h-11"
            onClick={() => openAccountPanelInUrl("cuadrar", account.id)}
          >
            <Scales aria-hidden weight="bold" className="size-4" />
            Cuadrar saldo
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="lg:min-h-10 lg:pointer-coarse:min-h-11"
            onClick={() => openAccountPanelInUrl("editar", account.id)}
          >
            <PencilSimple aria-hidden weight="bold" className="size-4" />
            Editar
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap gap-x-8 gap-y-4">
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
            {formatMoney(displayedAmount(account), space.currency)}
          </span>
        </div>
        <AccountMonthFigure
          account={account}
          space={space}
          month={filters.month}
          currentMonth={currentMonth}
          enabled={isDesktop}
          api={api}
        />
      </div>
      <AccountMovements
        account={account}
        space={space}
        month={filters.month}
        type={filters.type}
        onFiltersChange={setFilters}
        currentMonth={currentMonth}
        today={today}
        enabled={isDesktop}
        api={api}
      />
    </Card>
  );
}

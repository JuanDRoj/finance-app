"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { monthFigureLabel, monthFigureText } from "@/lib/core/account-movements";
import type { AccountType } from "@/lib/core/data/accounts";
import type { ApiClient } from "@/lib/core/data/api-client";
import { transactionsSummaryQueryOptions } from "@/lib/core/data/transactions";
import type { Currency } from "@/lib/core/money";

/**
 * The figure of the month under the balance in the detail of an account (K-V2-Escritorio, "cuentas"):
 * "Movimiento neto de octubre" with a sign for a bank or cash account, and "Consumos de octubre" for a
 * card. A label of 14 px in bold and the amount in Montserrat 600 at 20 px, 8 px lower.
 *
 * The figure comes from the summary filtered by this account and **this month only**: it does not
 * follow the type of the table (the backend's `balance_change_minor` ignores it; the same key as the
 * table's count when no type is chosen, so it is one request). The label is written from the account,
 * the month and the current month, so it is on screen while the amount loads or fails.
 *
 * - **Loading:** a block where the amount goes (`status`, "Cargando la cifra del mes"). It does not
 *   keep the figure of the previous month: a label of September over October's amount would lie.
 * - **Failed:** a dash and "Reintentar". A bank whose summary has no `balance_change_minor` (it only
 *   comes with `account_id`) is a failed summary too, never a zero.
 */
export function AccountMonthFigure({
  account,
  space,
  month,
  currentMonth,
  enabled,
  api,
}: Readonly<{
  account: { id: string; type: AccountType };
  space: { id: string; currency: Currency };
  month: string;
  currentMonth: string;
  /** Asks only from 1024 px: below it the detail is hidden and nothing should be requested. */
  enabled: boolean;
  api: ApiClient;
}>) {
  const summary = useQuery({
    ...transactionsSummaryQueryOptions(api, space.id, { month, accountId: account.id }),
    enabled,
  });
  const text = summary.data ? monthFigureText(summary.data, account.type, space.currency) : null;
  const failed = summary.isError || (summary.data !== undefined && text === null);
  // After a failure "Reintentar" puts the query back to pending: it keeps the notice, busy.
  const retrying = summary.isFetching && summary.errorUpdateCount > 0 && summary.data === undefined;

  let value: ReactNode;
  if (text !== null) {
    value = text;
  } else if (failed || retrying) {
    value = (
      <span className="inline-flex flex-wrap items-center gap-3">
        <span aria-hidden>—</span>
        <span className="sr-only">No disponible</span>
        <Button
          variant="outline"
          size="sm"
          aria-label="Reintentar: cifra del mes"
          loading={summary.isFetching}
          onClick={() => void summary.refetch()}
          className="lg:min-h-9 lg:pointer-coarse:min-h-11"
        >
          Reintentar
        </Button>
      </span>
    );
  } else {
    value = (
      <span role="status" aria-busy="true" aria-label="Cargando la cifra del mes">
        <Skeleton className="h-6 w-32 rounded-full" />
      </span>
    );
  }

  return (
    <div data-slot="account-month-figure" className="flex min-w-0 flex-col gap-1">
      <span className="text-sm font-bold text-muted-foreground">
        {monthFigureLabel(account.type, month, currentMonth)}
      </span>
      <span className="pt-2 font-heading text-xl font-semibold break-all tabular-nums">
        {value}
      </span>
    </div>
  );
}

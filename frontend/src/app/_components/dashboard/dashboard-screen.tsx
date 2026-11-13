"use client";

import { Bank, CreditCard, ListBullets } from "@phosphor-icons/react/ssr";
import { useMemo, type ReactNode } from "react";
import { browserApi } from "@/lib/api/browser";
import {
  compareExpense,
  describeAvailableNote,
  describeDebtNote,
  describeExpensesTitle,
  formatDashboardAmount,
} from "@/lib/core/dashboard";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { Currency } from "@/lib/core/money";
import { InlineError } from "./dashboard-states";
import { AccountsCard } from "./accounts-card";
import { IncomeExpenseCard } from "./income-expense-card";
import { NetCard } from "./net-card";
import { RecentMovementsCard } from "./recent-movements-card";
import { StatTile } from "./stat-tile";
import { TopExpensesCard } from "./top-expenses";
import { useDashboardData } from "./use-dashboard-data";

type DashboardScreenProps = {
  space: { id: string; currency: Currency };
  /** The space's current month (`YYYY-MM`) and day (`YYYY-MM-DD`), worked out by the server page in the space's time zone. */
  currentMonth: string;
  today: string;
  /** The card of the currency, while the space can still change it (`!currency_locked`); the page decides. */
  currencyCard?: ReactNode;
  /** The API client; the browser's by default (the catalog and the tests pass a scripted one). */
  api?: ApiClient;
};

/**
 * The Inicio of a space with accounts (FE-24, KAN-84; docs/diseno.md D9, D17 › Escritorio v2 and D18),
 * after the Kanza canvas (K-Inicio at 360 px, K-Tablet at 768 px, K-V2-Escritorio from 1024 px). The
 * server page prefetched four queries (the dashboard, the series of six months, the six latest
 * movements and the accounts) and hydrates them here; every card reads what it needs and has its own
 * loading and error state, so one failing request never takes the rest down.
 *
 * - **Below 1024 px** (a phone, a tablet; one column of 640 px at most): a grid of two columns with the
 *   Neto, Disponible and Deuda de tarjetas side by side, and "Gastos de octubre" (the top 5). The
 *   cards of the charts, the movements and the accounts are `max-lg:hidden`, and so are the series and
 *   the movements (`useDashboardData`). The card of the currency, if it comes, closes the column.
 * - **From 1024 px** a row that wraps, as the canvas draws it (`flex-wrap`, 14 px apart, bases of 560 and
 *   280 or 320 and a grow of 2 to 1). Row 1: the Neto (with its evolution and the cricket) and three
 *   tiles stacked (Disponible, Deuda de tarjetas and "Gastos de octubre" with its comparison). Row 2:
 *   Ingresos y gastos and "Gastos por categoría". Row 3: Últimos movimientos and, in a column of one
 *   third, Cuentas with the card of the currency under it. A row falls into one column, without
 *   breaking, when its two bases no longer fit (the content column is the window minus 304 px): row 1
 *   under about 1160 px of window, row 2 under about 1200 and row 3 under about 1270.
 * - **Deviation from the canvas, on purpose:** row 3 has bases of **668 and 280** where the canvas has
 *   560 and 320. At 1280 px the canvas' table has a floor of 620 px in a card of about 567 px of room
 *   and scrolls sideways, hiding "Monto", its last column; with 668 the card is about 673 px wide
 *   and fits. At 1440 px both are the same size or more.
 * - The dashboard failing takes the place of the Neto and the tiles with one error and "Reintentar";
 *   the series failing only leaves out the chip of change, the comparison and the two charts' content.
 */
export function DashboardScreen({
  space,
  currentMonth,
  today,
  currencyCard,
  api = browserApi,
}: Readonly<DashboardScreenProps>) {
  const { dashboard, series, recent, accounts } = useDashboardData(api, space.id);
  const { currency } = space;
  const figures = dashboard.data;
  const points = series.data?.points;

  // The note of "Gastos de octubre": BigInt arithmetic over the series, so it is worked out again only
  // when the series, the day or the month's expenses change, not on every render of the screen.
  const monthExpense = figures?.month_expense_minor;
  const comparison = useMemo(
    () =>
      points && monthExpense !== undefined ? compareExpense(points, today, monthExpense) : null,
    [points, today, monthExpense],
  );

  return (
    <div
      data-slot="dashboard"
      className="grid grid-cols-2 gap-2.5 md:gap-3.5 lg:flex lg:flex-wrap lg:items-stretch"
    >
      {dashboard.failed ? (
        <div className="col-span-2 lg:basis-full">
          <InlineError
            title="No se pudo cargar tu resumen"
            error={dashboard.error}
            onRetry={dashboard.retry}
            busy={dashboard.busy}
          />
        </div>
      ) : (
        <>
          <NetCard
            dashboard={figures}
            series={series}
            currency={currency}
            className="col-span-2 lg:basis-140 lg:grow-2"
          />
          {/* A plain column of tiles from 1024 px; below it the wrapper vanishes and the two tiles are cells of the grid. */}
          <div
            data-slot="dashboard-tiles"
            className="contents lg:flex lg:min-w-0 lg:basis-70 lg:grow lg:flex-col lg:gap-3.5"
          >
            <StatTile
              label="Disponible"
              icon={<Bank weight="duotone" aria-hidden />}
              value={figures ? formatDashboardAmount(figures.available_minor, currency) : undefined}
              note={accounts.data ? describeAvailableNote(accounts.data) : undefined}
              noteClassName="max-md:hidden"
            />
            <StatTile
              label="Deuda de tarjetas"
              icon={<CreditCard weight="duotone" aria-hidden />}
              tone={figures && figures.card_debt_minor > 0 ? "debt" : "default"}
              value={figures ? formatDashboardAmount(figures.card_debt_minor, currency) : undefined}
              note={accounts.data ? describeDebtNote(accounts.data) : undefined}
            />
            <StatTile
              label={describeExpensesTitle(figures?.month ?? currentMonth)}
              icon={<ListBullets weight="duotone" aria-hidden />}
              value={
                figures ? formatDashboardAmount(figures.month_expense_minor, currency) : undefined
              }
              note={comparison?.text}
              className="max-lg:hidden"
            />
          </div>
        </>
      )}

      <IncomeExpenseCard series={series} currency={currency} className="lg:basis-140 lg:grow-2" />
      <TopExpensesCard
        dashboard={dashboard}
        currency={currency}
        currentMonth={currentMonth}
        className="col-span-2 lg:basis-80 lg:grow"
      />

      {/* Row 3. 668 and 280 where the canvas has 560 and 320, on purpose: see the comment above. */}
      <RecentMovementsCard
        recent={recent}
        currency={currency}
        today={today}
        className="lg:basis-167 lg:grow-2"
      />
      <div
        data-slot="dashboard-aside"
        className="contents lg:flex lg:min-w-0 lg:basis-70 lg:grow lg:flex-col lg:gap-3.5"
      >
        <AccountsCard accounts={accounts} currency={currency} className="lg:flex-1" />
        {currencyCard ? <div className="col-span-2 lg:col-auto">{currencyCard}</div> : null}
      </div>
    </div>
  );
}

"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { MoreFooter, NextPageError } from "@/app/movimientos/_components/load-more";
import { MonthSelect } from "@/app/movimientos/_components/month-select";
import { TypeChips } from "@/app/movimientos/_components/type-chips";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describeAccountEmpty, describeAccountTableCaption } from "@/lib/core/account-movements";
import type { AccountType } from "@/lib/core/data/accounts";
import type { ApiClient } from "@/lib/core/data/api-client";
import {
  transactionsListKey,
  transactionsListQueryOptions,
  transactionsSummaryQueryOptions,
} from "@/lib/core/data/transactions";
import { formatMonth } from "@/lib/core/dates";
import { describeApiError } from "@/lib/core/i18n";
import type { Currency } from "@/lib/core/money";
import {
  describeMovementCount,
  describeShown,
  flattenMovementPages,
  isCursorInvalid,
  type MovementFiltersPatch,
  type MovementTypeFilter,
} from "@/lib/core/movements";
import { cn } from "@/lib/utils";
import { AccountFilterToggle } from "./account-filter-toggle";
import { AccountMovementsSkeleton } from "./account-movements-skeleton";
import { AccountMovementsTable } from "./account-movements-table";

type AccountMovementsProps = {
  account: { id: string; name: string; type: AccountType };
  space: { id: string; currency: Currency };
  /** The month shown (`YYYY-MM`) and the type chosen, both from the URL (`useMovementFilters`). */
  month: string;
  type: MovementTypeFilter | undefined;
  /** Changes the month or the type in the URL (`useMovementFilters().setFilters`). */
  onFiltersChange: (patch: MovementFiltersPatch) => void;
  /** The current month and day of the space's zone, computed by the server page. */
  currentMonth: string;
  today: string;
  /** Asks only from 1024 px: below it the detail is hidden and nothing should be requested. */
  enabled: boolean;
  api: ApiClient;
};

/**
 * The movements of the chosen account, in the detail of Cuentas (docs/diseno.md D17 › Escritorio v2,
 * D18; K-V2-Escritorio, "cuentas"; FE-26 / KAN-89): the title "Movimientos" with the month and
 * "Filtrar" on the right and, below, the table with the **balance after each movement** (or the debt,
 * for a card), "Mostrando n de m movimientos" and "Cargar más".
 *
 * - **Data.** Two queries in parallel, both filtered by this account: the list (infinite, 50 per
 *   page, the cursor of the backend) and the summary of the same filters (the `m` of "n de m"). The
 *   balance is the backend's (`balance_after_minor`); nothing is added up here. Both hang from
 *   `transactionsQueryKey`, so registering, editing or deleting a movement, or reconciling the
 *   account, asks them again by itself (the same invalidations Movimientos has).
 * - **Month and type.** `?mes=` and `?tipo=` of the URL, as in Movimientos (`useMovementFilters`, in
 *   the detail): they survive choosing another account. "Filtrar" shows the row with the four types
 *   (`TypeChips`) and opens by itself when the URL already has a `?tipo`. The balance column does not
 *   change with the type: the backend counts every movement of the account.
 * - **Changing the month or the type** keeps the previous rows dimmed and `aria-busy`
 *   (`keepPreviousData`) instead of jumping to a skeleton; while they are the old ones "Cargar más" is
 *   off (its cursor belongs to another list). The detail is remounted for each account (`key`), so the
 *   rows of one account are never shown under another.
 * - **Failures.** The first load failing is an `Alert` with "Reintentar" (never "empty", also for a
 *   404); a refresh that fails with rows on screen keeps them and says so; a next page that fails
 *   says so once and asks nothing until "Reintentar" (an unreadable cursor, the 422 `cursor_invalid`,
 *   starts the list again).
 * - **Empty.** "Esta cuenta no tiene movimientos este mes" (or "en septiembre"), and with a type
 *   chosen "No hay movimientos de este tipo" with "Quitar filtro".
 */
export function AccountMovements({
  account,
  space,
  month,
  type,
  onFiltersChange,
  currentMonth,
  today,
  enabled,
  api,
}: AccountMovementsProps) {
  const queryClient = useQueryClient();
  const filters = { month, type, accountId: account.id };

  const list = useInfiniteQuery({
    ...transactionsListQueryOptions(api, space.id, filters),
    placeholderData: keepPreviousData,
    enabled,
  });
  // The `m` of "Mostrando n de m": the summary of the same filters. With no type it is the very query
  // of the figure of the month (the same key), so it is one request.
  const summary = useQuery({
    ...transactionsSummaryQueryOptions(api, space.id, filters),
    placeholderData: keepPreviousData,
    enabled,
  });

  const rows = useMemo(() => flattenMovementPages(list.data), [list.data]);
  const placeholder = list.isPlaceholderData;
  const period = formatMonth(month);
  const busy = placeholder || summary.isPlaceholderData;

  const fetchNextPage = list.fetchNextPage;
  const loadMore = useCallback(() => {
    // `cancelRefetch: false`: a second call while a page is on its way is ignored, not restarted.
    void fetchNextPage({ cancelRefetch: false });
  }, [fetchNextPage]);
  const retryNextPage = () => {
    // Only an unreadable cursor starts the list over; any other failure asks for the same page again.
    if (isCursorInvalid(list.error)) {
      void queryClient.resetQueries({
        queryKey: transactionsListKey(space.id, filters),
        exact: true,
      });
    } else {
      loadMore();
    }
  };

  const [filtersOpen, setFiltersOpen] = useState(type !== undefined);
  const filtersId = useId();
  const headingId = useId();
  const filtersRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const clearType = () => {
    onFiltersChange({ type: undefined });
    // "Quitar filtro" goes away with the state it was in, and the focus must land somewhere (WCAG
    // 2.4.3). With the row of the types open it goes to the first of them, the filter that was just
    // taken off. With the row closed (a type on, and the row put away by hand) those chips are
    // `hidden` and cannot take the focus, so it goes to "Filtrar": it is the control of that filter,
    // it stays, and its name changes from "Filtrar, 1 filtro activo" to "Filtrar". Opening the row
    // instead would move the layout under the person's pointer.
    const target = filtersOpen
      ? filtersRef.current?.querySelector<HTMLElement>("[data-slot='type-chips'] button")
      : toggleRef.current;
    target?.focus();
  };

  let body: ReactNode;
  if (list.data === undefined) {
    body = list.isError ? (
      <Alert
        title="No se pudieron cargar los movimientos de esta cuenta"
        action={
          <Button
            variant="secondary"
            size="sm"
            loading={list.isFetching}
            onClick={() => void list.refetch()}
            className="lg:min-h-10 lg:pointer-coarse:min-h-11"
          >
            Reintentar
          </Button>
        }
      >
        {describeApiError(list.error).message}
      </Alert>
    ) : (
      <AccountMovementsSkeleton />
    );
  } else if (rows.length === 0) {
    body = placeholder ? (
      <AccountMovementsSkeleton />
    ) : (
      <div
        data-slot="account-movements-empty"
        className="flex flex-col items-center gap-2.5 border-t border-border px-4 py-8 text-center"
      >
        <p className="font-heading text-base font-bold text-balance">
          {describeAccountEmpty(month, currentMonth, type !== undefined)}
        </p>
        {type !== undefined ? (
          <Button
            variant="outline"
            size="sm"
            onClick={clearType}
            className="lg:min-h-10 lg:pointer-coarse:min-h-11"
          >
            Quitar filtro
          </Button>
        ) : null}
      </div>
    );
  } else {
    const refreshFailed = list.isError && !list.isFetchNextPageError;
    const shown = summary.data
      ? describeShown(rows.length, summary.data.count)
      : `Mostrando ${describeMovementCount(rows.length)}`;
    const paused = placeholder || list.isFetchNextPageError || refreshFailed;
    body = (
      <div
        aria-busy={busy || undefined}
        className={cn(
          "flex flex-col gap-3 transition-opacity motion-reduce:transition-none",
          busy && "opacity-60",
        )}
      >
        {refreshFailed ? (
          <Alert
            title="No se pudo actualizar la lista"
            action={
              <Button
                variant="secondary"
                size="sm"
                loading={list.isFetching}
                onClick={() => void list.refetch()}
                className="lg:min-h-10 lg:pointer-coarse:min-h-11"
              >
                Reintentar
              </Button>
            }
          >
            Estás viendo los movimientos que ya habías cargado. Tus datos están a salvo.
          </Alert>
        ) : null}
        <div>
          <AccountMovementsTable
            items={rows}
            account={account}
            currency={space.currency}
            today={today}
            caption={describeAccountTableCaption(account.name, period)}
            className="mb-1"
          />
          <MoreFooter
            text={shown}
            hasNextPage={list.hasNextPage}
            loading={list.isFetchingNextPage}
            paused={paused}
            onLoadMore={loadMore}
          />
        </div>
        {list.isFetchNextPageError ? (
          <NextPageError
            error={list.error}
            onRetry={retryNextPage}
            busy={list.isFetchingNextPage}
          />
        ) : null}
      </div>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      data-slot="account-movements"
      className="flex min-w-0 flex-col gap-4.5 border-t border-border pt-4"
    >
      {/* The month and the count, announced once when the filters change; the line above is for sight. */}
      <p role="status" className="sr-only">
        {summary.data && !summary.isPlaceholderData
          ? `${period}: ${describeMovementCount(summary.data.count)}`
          : ""}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={headingId} className="font-heading text-section-title font-bold">
          Movimientos
        </h3>
        <div className="flex items-center gap-2">
          <MonthSelect
            variant="compact"
            month={month}
            currentMonth={currentMonth}
            onMonthChange={(next) => onFiltersChange({ month: next })}
          />
          <AccountFilterToggle
            ref={toggleRef}
            open={filtersOpen}
            count={type !== undefined ? 1 : 0}
            controls={filtersId}
            onToggle={() => setFiltersOpen((open) => !open)}
          />
        </div>
      </div>
      <div ref={filtersRef} id={filtersId} hidden={!filtersOpen}>
        <TypeChips type={type} onTypeChange={(next) => onFiltersChange({ type: next })} />
      </div>
      {body}
    </section>
  );
}

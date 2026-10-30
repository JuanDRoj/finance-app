"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo, useRef, type ReactNode } from "react";
import { MovementDayGroups } from "@/components/movements/movement-day-group";
import { MovementsEmpty } from "@/components/movements/movements-empty";
import { MovementsError } from "@/components/movements/movements-error";
import { MovementsNoResults } from "@/components/movements/movements-no-results";
import { MovementsSkeleton } from "@/components/movements/movements-skeleton";
import { MovementsSummary } from "@/components/movements/movements-summary";
import { MovementsTable } from "@/components/movements/movements-table";
import { NEW_ACCOUNT_ACTION, PRIMARY_ACTION } from "@/components/nav-sections";
import { DESKTOP_MEDIA_QUERY } from "@/components/use-is-desktop";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { browserApi } from "@/lib/api/browser";
import { accountsQueryOptions } from "@/lib/core/data/accounts";
import type { ApiClient } from "@/lib/core/data/api-client";
import { ApiError } from "@/lib/core/data/errors";
import {
  transactionsListKey,
  transactionsListQueryOptions,
  transactionsSummaryQueryOptions,
} from "@/lib/core/data/transactions";
import { formatMonth } from "@/lib/core/dates";
import type { Currency } from "@/lib/core/money";
import {
  chooseEmptyState,
  describeMovementCount,
  describeShown,
  flattenMovementPages,
  groupMovementsByDay,
  hasActiveFilters,
  showsSummary,
} from "@/lib/core/movements";
import { cn } from "@/lib/utils";
import { MoreFooter, MoreSentinel, NextPageError } from "./load-more";
import { MonthNav } from "./month-nav";
import { MovementFiltersCard } from "./movement-filters-card";
import { TypeChips } from "./type-chips";
import { useMovementFilters } from "./use-movement-filters";

type MovementsScreenProps = {
  space: { id: string; currency: Currency };
  /** The current month of the space's zone (`YYYY-MM`), computed by the server page. */
  currentMonth: string;
  /** The space's day (`YYYY-MM-DD`), computed by the server page: what "Hoy" and "Ayer" mean. */
  today: string;
  /** The API client; the browser's by default (the catalog and the tests pass a scripted one). */
  api?: ApiClient;
};

/** A 422 of the list is a cursor the backend cannot read: asking for the same page again cannot work. */
function isUnprocessable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 422;
}

/**
 * The body of Movimientos (docs/diseno.md D17 › Escritorio v2, D19; K-H1-Movimientos and
 * K-V2-Escritorio): the filters, the summary of the period and the movements of the month, newest
 * first. The filters live in the URL (`useMovementFilters`) and the data come from four queries:
 * the list (infinite, 50 per page, the server prefetched its first page), the summary of the same
 * filters, the accounts (to know whether there is one to register on) and, only when the list is
 * empty, the summary of the **whole space**, which tells "Aún no tienes movimientos" from "No hay
 * movimientos con estos filtros" (`chooseEmptyState`).
 *
 * - **Changing a filter** keeps the rows of the previous one on screen, dimmed and `aria-busy`
 *   (`keepPreviousData`), instead of jumping to a skeleton. While they are the old ones, "Cargar más"
 *   and the sentinel are off: their cursor belongs to another list.
 * - **A phone** (below 1024 px) gets the month with its arrows, the type chips, the summary and the
 *   days, and loads the next page by itself near the end. **Desktop** gets the filters card, the three
 *   figures and the table, with "Mostrando n de m" and "Cargar más". Both lists are in the page and
 *   CSS hides one, so nothing changes size when it hydrates.
 * - **Failures.** The first load failing is "No se pudieron cargar tus movimientos" with
 *   "Reintentar" (never "no movements"); a refresh that fails with rows on screen keeps them and says
 *   so; a next page that fails says so once, under the list, and asks nothing until "Reintentar"
 *   (a 422 starts the list again from the first page).
 * - **A space with no movement** shows the invitation. On desktop it hides the filters and the
 *   figures (there is nothing to filter); on a phone the month and the chips stay, as the canvas draws.
 * - The rows are **read only** (FE-22); editing and deleting are FE-23's.
 */
export function MovementsScreen({
  space,
  currentMonth,
  today,
  api = browserApi,
}: MovementsScreenProps) {
  const queryClient = useQueryClient();
  const { filters, setFilters, clearFilters } = useMovementFilters(currentMonth);

  const list = useInfiniteQuery({
    ...transactionsListQueryOptions(api, space.id, filters),
    placeholderData: keepPreviousData,
  });
  const summary = useQuery({
    ...transactionsSummaryQueryOptions(api, space.id, filters),
    placeholderData: keepPreviousData,
  });
  const accounts = useQuery(accountsQueryOptions(api, space.id, { includeArchived: true }));

  const rows = useMemo(() => flattenMovementPages(list.data), [list.data]);
  const groups = useMemo(() => groupMovementsByDay(rows, today), [rows, today]);

  const placeholder = list.isPlaceholderData;
  const listIsEmpty = list.data !== undefined && !placeholder && rows.length === 0;
  const total = useQuery({
    ...transactionsSummaryQueryOptions(api, space.id, {}),
    enabled: listIsEmpty,
  });
  const emptyKind = listIsEmpty
    ? chooseEmptyState({ count: total.data?.count, failed: total.isError })
    : undefined;
  const spaceIsEmpty = emptyKind === "empty";

  // The page cannot register a movement with no active account: the invitation then says so.
  const noAccounts =
    accounts.data !== undefined && accounts.data.every((a) => a.archived_at !== null);

  const period = formatMonth(filters.month);
  const busy = placeholder || summary.isPlaceholderData;
  const fetchNextPage = list.fetchNextPage;
  const loadMore = useCallback(() => {
    // `cancelRefetch: false`: a second call while a page is on its way is ignored, not restarted.
    void fetchNextPage({ cancelRefetch: false });
  }, [fetchNextPage]);
  const retryNextPage = () => {
    if (isUnprocessable(list.error)) {
      void queryClient.resetQueries({
        queryKey: transactionsListKey(space.id, filters),
        exact: true,
      });
    } else {
      loadMore();
    }
  };

  const filtersCardRef = useRef<HTMLDivElement>(null);
  const phoneControlsRef = useRef<HTMLDivElement>(null);
  const clearAndFocus = () => {
    clearFilters();
    // "Quitar filtros" goes away with the state it was in: the focus goes to the type, the first filter.
    const desktop = window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
    (desktop ? filtersCardRef : phoneControlsRef).current
      ?.querySelector<HTMLElement>("[data-slot='type-chips'] button")
      ?.focus();
  };

  let body: ReactNode;
  if (list.data === undefined) {
    body = list.isError ? (
      <MovementsError onRetry={() => void list.refetch()} busy={list.isFetching} />
    ) : (
      <MovementsSkeleton />
    );
  } else if (rows.length === 0) {
    if (placeholder || emptyKind === "loading") {
      body = <MovementsSkeleton />;
    } else if (spaceIsEmpty) {
      body = <MovementsEmpty action={noAccounts ? NEW_ACCOUNT_ACTION : PRIMARY_ACTION} />;
    } else {
      // On desktop it lives inside a card like the table's; on a phone it is its own glass card.
      body = (
        <div className="lg:rounded-card lg:border lg:border-border lg:bg-surface lg:px-5.5">
          <MovementsNoResults
            onClearFilters={hasActiveFilters(filters) ? clearAndFocus : undefined}
          />
        </div>
      );
    }
  } else {
    const refreshFailed = list.isError && !list.isFetchNextPageError;
    const figures = summary.data;
    const shown = figures
      ? describeShown(rows.length, figures.count)
      : `Mostrando ${describeMovementCount(rows.length)}`;
    const paused = placeholder || list.isFetchNextPageError || refreshFailed;
    body = (
      <div
        aria-busy={busy || undefined}
        className={cn(
          "flex flex-col gap-2.5 transition-opacity motion-reduce:transition-none lg:gap-3.5",
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
              >
                Reintentar
              </Button>
            }
          >
            Estás viendo los movimientos que ya habías cargado. Tus datos están a salvo.
          </Alert>
        ) : null}
        {figures && showsSummary(filters) ? (
          <MovementsSummary summary={figures} currency={space.currency} period={period} />
        ) : null}
        <MovementDayGroups groups={groups} currency={space.currency} className="lg:hidden" />
        <div className="rounded-card border border-border bg-surface px-5.5 pt-2.5 pb-4 max-lg:hidden">
          <MovementsTable
            items={rows}
            currency={space.currency}
            today={today}
            caption={`Movimientos de ${period}`}
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
        <MoreSentinel
          hasNextPage={list.hasNextPage}
          loading={list.isFetchingNextPage}
          paused={paused}
          onLoadMore={loadMore}
          className="lg:hidden"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 lg:gap-3.5">
      {/* The count of the period, announced when the filters change; the line under the title is for sight. */}
      <p role="status" className="sr-only">
        {summary.data && !summary.isPlaceholderData
          ? describeMovementCount(summary.data.count)
          : ""}
      </p>
      {spaceIsEmpty ? null : (
        <div ref={filtersCardRef} className="max-lg:hidden">
          <MovementFiltersCard
            filters={filters}
            currentMonth={currentMonth}
            onChange={setFilters}
          />
        </div>
      )}
      <div ref={phoneControlsRef} className="flex flex-col gap-2 lg:hidden">
        {/* The right of this row is for "Filtrar" (FE-33). */}
        <div className="-ml-3 flex items-center justify-between">
          <MonthNav month={filters.month} onMonthChange={(month) => setFilters({ month })} />
        </div>
        <TypeChips type={filters.type} onTypeChange={(type) => setFilters({ type })} />
      </div>
      {body}
    </div>
  );
}

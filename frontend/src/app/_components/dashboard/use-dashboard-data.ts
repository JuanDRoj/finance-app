"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";
import { useIsDesktop } from "@/components/use-is-desktop";
import { splitArchived } from "@/lib/core/accounts-summary";
import { accountsQueryOptions, type AccountWithBalance } from "@/lib/core/data/accounts";
import type { ApiClient } from "@/lib/core/data/api-client";
import {
  dashboardQueryOptions,
  dashboardSeriesQueryOptions,
  type DashboardRead,
  type DashboardSeries,
} from "@/lib/core/data/dashboard";
import {
  recentTransactionsQueryOptions,
  type MovementListItem,
} from "@/lib/core/data/transactions";

// What the Inicio's cards read (FE-24, KAN-84): the four queries of the screen, each turned into the
// small `Load` a card needs to say "loading", "failed" or show its data.

/**
 * What a card needs of a query. `failed` is a query that has nothing to show and gave up (after its
 * retries): a refresh that fails with data on screen keeps the data (`failed` stays false). `busy` is
 * a request in flight, which the "Reintentar" button shows.
 */
export type Load<T> = {
  data: T | undefined;
  error: unknown;
  failed: boolean;
  busy: boolean;
  retry: () => void;
};

export function loadOf<T>(query: UseQueryResult<T>): Load<T> {
  return {
    data: query.data,
    error: query.error,
    failed: query.isError && query.data === undefined,
    busy: query.isFetching,
    retry: () => void query.refetch(),
  };
}

export type DashboardData = {
  dashboard: Load<DashboardRead>;
  /** The months of the charts; asked only from 1024 px (a phone has no chart, no chip of change and no comparison). */
  series: Load<DashboardSeries>;
  /** The six latest movements; asked only from 1024 px (a phone has no table). */
  recent: Load<MovementListItem[]>;
  /** The active accounts, in the order the API gives them. */
  accounts: Load<AccountWithBalance[]>;
};

/**
 * The four queries of the Inicio. The server prefetched all of them for every width (it cannot know
 * the screen), so what is hydrated is there at once; `series` and `recent` are `enabled` only from
 * 1024 px, which is where their cards exist: below it they are never asked again, not even when a
 * movement is registered and the movements are invalidated. The accounts are asked with their
 * archived ones, the key Cuentas, Movimientos and the sheet of "Registrar" share, and told apart here.
 */
export function useDashboardData(api: ApiClient, spaceId: string): DashboardData {
  const desktop = useIsDesktop();
  const dashboard = useQuery(dashboardQueryOptions(api, spaceId));
  const series = useQuery({ ...dashboardSeriesQueryOptions(api, spaceId), enabled: desktop });
  const recent = useQuery({ ...recentTransactionsQueryOptions(api, spaceId), enabled: desktop });
  const accounts = useQuery(accountsQueryOptions(api, spaceId, { includeArchived: true }));

  const active = useMemo(
    () => (accounts.data ? splitArchived(accounts.data).active : undefined),
    [accounts.data],
  );

  return {
    dashboard: loadOf(dashboard),
    series: loadOf(series),
    recent: loadOf(recent),
    accounts: { ...loadOf(accounts), data: active },
  };
}

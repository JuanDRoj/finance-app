"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { browserApi } from "@/lib/api/browser";
import type { ApiClient } from "@/lib/core/data/api-client";
import { transactionsSummaryQueryOptions } from "@/lib/core/data/transactions";
import { formatMonth } from "@/lib/core/dates";
import { describeMovementCount } from "@/lib/core/movements";
import { useMovementFilters } from "./use-movement-filters";

/**
 * The line under the title of Movimientos from 1024 px (docs/diseno.md D17 › Escritorio v2): "Octubre
 * 2026 · 48 movimientos", the month and how many movements the filters leave. It is a Client
 * Component because the page (a Server Component) does not know the month the person is on: it
 * reads the same URL as the screen and asks for the same summary (one request, the query is shared
 * with `MovementsScreen`). Without a count (still loading, failed, or none) it is just the month;
 * and while the summary is the one of the month before it also leaves the count out, so "Setiembre
 * 2026" is never followed by the figure of October.
 */
export function MovementsSubtitle({
  spaceId,
  currentMonth,
  api = browserApi,
}: Readonly<{ spaceId: string; currentMonth: string; api?: ApiClient }>) {
  const { filters } = useMovementFilters(currentMonth);
  const summary = useQuery({
    ...transactionsSummaryQueryOptions(api, spaceId, filters),
    placeholderData: keepPreviousData,
  });
  const count = summary.isPlaceholderData ? undefined : summary.data?.count;
  return (
    <>
      {formatMonth(filters.month)}
      {count ? ` · ${describeMovementCount(count)}` : null}
    </>
  );
}

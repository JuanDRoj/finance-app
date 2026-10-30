import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getServerApi } from "@/lib/api/server";
import { splitArchived } from "@/lib/core/accounts-summary";
import { accountsQueryOptions } from "@/lib/core/data/accounts";
import { ApiError, isUnauthorized } from "@/lib/core/data/errors";
import { loadShellData } from "@/lib/core/data/shell";
import {
  transactionsListQueryOptions,
  transactionsSummaryQueryOptions,
} from "@/lib/core/data/transactions";
import { currentMonthIn, todayInTimezone } from "@/lib/core/dates";
import { describeApiError } from "@/lib/core/i18n";
import { parseMovementFilters } from "@/lib/core/movements";
import { MovementsHeaderActions } from "./_components/movements-header-actions";
import { MovementsScreen } from "./_components/movements-screen";
import { MovementsSubtitle } from "./_components/movements-subtitle";

export const metadata: Metadata = { title: "Movimientos" };

/** Only the kind of failure, never the message (see the Inicio). */
function describeFailure(error: unknown) {
  return error instanceof ApiError
    ? { status: error.status }
    : { kind: error instanceof Error ? error.name : typeof error };
}

/**
 * Movimientos (docs/diseno.md D17 › Escritorio v2, D19; KAN-82 / FE-22). A Server Component: it asks
 * `/me` and `/spaces` (`loadShellData`), reads the filters from the URL (`?mes`, `?tipo`, `?q`…) and
 * prefetches, in parallel, the first page of the list, the summary of the same filters and the
 * accounts (archived ones included) into a `QueryClient` of this request. The `HydrationBoundary`
 * wraps the **whole shell**, not just the screen: the line under the title (a Client Component that
 * writes the month and the count) is part of the header and has to find its summary already there.
 *
 * - No session or an expired one (401, from any call): `/login`.
 * - A failure of `/me` or `/spaces`: an `Alert` with "Reintentar". A failure of the list, of the
 *   summary or of the accounts is left to the client: that query is not hydrated, the screen asks
 *   again by itself and shows its own error (never "no movements").
 * - `today` and `currentMonth` are the **space's** (its time zone, not the device's), computed here and
 *   handed down, so the server and the browser write the same "Hoy" and the same month.
 * - `noAccounts` goes to the shell only when the accounts loaded and none is active, as in Cuentas.
 * - From 1024 px the header has "Registrar movimiento" and the line "Octubre 2026 · 48 movimientos";
 *   the sidebar and the bottom bar have Movimientos (its entry in `NAV_SECTIONS`).
 */
export default async function MovementsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const api = await getServerApi();
  const [result, query] = await Promise.all([loadShellData(api), searchParams]);

  if (!result.ok) {
    const { error } = result;
    if (isUnauthorized(error)) redirect("/login");
    console.error("Movimientos: could not load /me and /spaces", describeFailure(error));
    const { title, message } = describeApiError(error);
    return (
      <AppShell title="Movimientos">
        <Alert
          title={title}
          action={
            <Button
              variant="secondary"
              size="sm"
              nativeButton={false}
              render={<Link href="/movimientos" />}
            >
              Reintentar
            </Button>
          }
        >
          {message}
        </Alert>
      </AppShell>
    );
  }

  const { user } = result;
  const space = result.spaces[0];
  if (!space) {
    return (
      <AppShell title="Movimientos" user={user}>
        <Alert variant="info" title="Todavía no tienes un espacio">
          Vuelve a iniciar sesión y lo preparamos por ti. Tus datos están a salvo.
        </Alert>
      </AppShell>
    );
  }

  const currentMonth = currentMonthIn(space.timezone);
  const today = todayInTimezone(space.timezone);
  const filters = parseMovementFilters(query, currentMonth);

  // One QueryClient per request, never shared: these are a user's data.
  const queryClient = new QueryClient();
  const listOptions = transactionsListQueryOptions(api, space.id, filters);
  const summaryOptions = transactionsSummaryQueryOptions(api, space.id, filters);
  const accountsOptions = accountsQueryOptions(api, space.id, { includeArchived: true });
  await Promise.all([
    queryClient.prefetchInfiniteQuery(listOptions),
    queryClient.prefetchQuery(summaryOptions),
    queryClient.prefetchQuery(accountsOptions),
  ]);
  const failures = [
    ["the movements", listOptions.queryKey],
    ["the summary", summaryOptions.queryKey],
    ["the accounts", accountsOptions.queryKey],
  ] as const;
  const errors = failures.map(([name, key]) => ({
    name,
    error: queryClient.getQueryState(key)?.error,
  }));
  if (errors.some(({ error }) => isUnauthorized(error))) redirect("/login");
  for (const { name, error } of errors) {
    if (error) console.error(`Movimientos: could not load ${name}`, describeFailure(error));
  }

  const accounts = queryClient.getQueryData(accountsOptions.queryKey);
  // Only when the list loaded: if it failed the page does not know, and never takes "could not load"
  // for "no accounts" (the sheet of "Registrar" resolves it itself).
  const noAccounts = accounts ? splitArchived(accounts).active.length === 0 : undefined;

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <AppShell
        title="Movimientos"
        user={user}
        space={space}
        noAccounts={noAccounts}
        subtitle={<MovementsSubtitle spaceId={space.id} currentMonth={currentMonth} />}
        actions={<MovementsHeaderActions noAccounts={noAccounts} />}
      >
        <MovementsScreen
          space={{ id: space.id, currency: space.currency }}
          currentMonth={currentMonth}
          today={today}
        />
      </AppShell>
    </HydrationBoundary>
  );
}

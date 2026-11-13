import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CurrencyCard } from "@/components/currency/currency-card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getServerApi } from "@/lib/api/server";
import { splitArchived } from "@/lib/core/accounts-summary";
import { accountsQueryOptions } from "@/lib/core/data/accounts";
import { dashboardQueryOptions, dashboardSeriesQueryOptions } from "@/lib/core/data/dashboard";
import { ApiError, isUnauthorized } from "@/lib/core/data/errors";
import { loadShellData } from "@/lib/core/data/shell";
import { recentTransactionsQueryOptions } from "@/lib/core/data/transactions";
import { currentMonthIn, formatWeekdayDate, todayInTimezone } from "@/lib/core/dates";
import { describeApiError } from "@/lib/core/i18n";
import { displayNameOf } from "@/lib/core/user";
import { DashboardScreen } from "./_components/dashboard/dashboard-screen";
import { FirstUse } from "./_components/first-use";

export const metadata: Metadata = { title: "Inicio" };

/** Only the kind of failure: the status of an `ApiError`, or the name of any other error. Never its message (a parse error can quote a piece of the response body) nor the request. */
function describeFailure(error: unknown) {
  return error instanceof ApiError
    ? { status: error.status }
    : { kind: error instanceof Error ? error.name : typeof error };
}

/** An `Alert` in Spanish with a way to try again: a link to `/` itself, which asks the backend again. */
function RetryAlert({ error }: Readonly<{ error: unknown }>) {
  const { title, message } = describeApiError(error);
  return (
    <Alert
      title={title}
      action={
        <Button variant="secondary" size="sm" nativeButton={false} render={<Link href="/" />}>
          Reintentar
        </Button>
      }
    >
      {message}
    </Alert>
  );
}

/**
 * Home (docs/diseno.md D9, D17 › Escritorio v2 and D18; KAN-84 / FE-24). A Server Component on
 * purpose: the greeting is in the HTML the server sends, so there is no loading state and no flash
 * (no `loading.tsx`, no Suspense). It asks `/me` and `/spaces` with the session cookie of the request
 * (`getServerApi`), together and with the 401 rule of `loadShellData`, and then, in parallel, the four
 * things the dashboard needs, into a `QueryClient` of this request (never shared: they are a user's
 * data) that `HydrationBoundary` hands to `DashboardScreen`: the dashboard of the month, the series of
 * six months, the six latest movements and the accounts (archived ones included: the key Cuentas,
 * Movimientos and the sheet of "Registrar" share). It prefetches all of them for every width, because
 * the server cannot know the screen; the client asks again only for what its width shows.
 *
 * - No session or an expired one (401 from any call): `/login`. The proxy of KAN-27 only sees that a
 *   cookie exists, never whether it is valid, so this check stays.
 * - A failure of `/me` or `/spaces`, or of the accounts: an `Alert` in Spanish (`describeApiError`)
 *   with a way to try again. The accounts decide between the first use and the dashboard, so a failing
 *   list is that and never "no accounts".
 * - A failure of the dashboard, the series or the movements: the page is drawn anyway. That query is
 *   not hydrated, the card asks again by itself and shows its own error with "Reintentar".
 * - No spaces: a notice. The backend creates the personal space together with the user, so this is not
 *   expected; the first space is the one shown until there is a space selector.
 * - No active accounts: the first use (D18): the invitation to create the first one.
 * - Active accounts: the dashboard. `today` and `currentMonth` are the **space's** (its time zone, not the
 *   device's), worked out here and handed down, so the server and the browser write the same month and
 *   the same "8 % menos que en setiembre".
 * - While the space has no movements (`currency_locked` is false), the card of its currency, with
 *   "Cambiar": the same rule as the backend's, which refuses the change after the first movement. In
 *   the first use it goes next to the invitation; in the dashboard, at the end (under Cuentas on a desktop).
 */
export default async function HomePage() {
  const api = await getServerApi();
  const result = await loadShellData(api);

  if (!result.ok) {
    const { error } = result;
    if (isUnauthorized(error)) redirect("/login");

    console.error("Home: could not load /me and /spaces", describeFailure(error));
    return (
      <AppShell title="Inicio">
        <RetryAlert error={error} />
      </AppShell>
    );
  }

  const { user } = result;
  const space = result.spaces[0];
  const title = `Hola, ${displayNameOf(user)}`;

  if (!space) {
    return (
      <AppShell title={title} user={user}>
        <Alert variant="info" title="Todavía no tienes un espacio">
          Vuelve a iniciar sesión y lo preparamos por ti. Tus datos están a salvo.
        </Alert>
      </AppShell>
    );
  }

  const currentMonth = currentMonthIn(space.timezone);
  const today = todayInTimezone(space.timezone);

  const queryClient = new QueryClient();
  const dashboardOptions = dashboardQueryOptions(api, space.id);
  const seriesOptions = dashboardSeriesQueryOptions(api, space.id);
  const recentOptions = recentTransactionsQueryOptions(api, space.id);
  const accountsOptions = accountsQueryOptions(api, space.id, { includeArchived: true });
  await Promise.all([
    queryClient.prefetchQuery(dashboardOptions),
    queryClient.prefetchQuery(seriesOptions),
    queryClient.prefetchQuery(recentOptions),
    queryClient.prefetchQuery(accountsOptions),
  ]);
  const failures = [
    ["the dashboard", dashboardOptions.queryKey],
    ["the series", seriesOptions.queryKey],
    ["the latest movements", recentOptions.queryKey],
    ["the accounts", accountsOptions.queryKey],
  ] as const;
  const errors = failures.map(([name, key]) => ({
    name,
    error: queryClient.getQueryState(key)?.error,
  }));
  if (errors.some(({ error }) => isUnauthorized(error))) redirect("/login");
  for (const { name, error } of errors) {
    if (error) console.error(`Home: could not load ${name}`, describeFailure(error));
  }

  const accounts = queryClient.getQueryData(accountsOptions.queryKey);
  if (!accounts) {
    return (
      <AppShell title={title} user={user} space={space}>
        <RetryAlert error={queryClient.getQueryState(accountsOptions.queryKey)?.error} />
      </AppShell>
    );
  }

  const hasAccounts = splitArchived(accounts).active.length > 0;
  const currencyCard = space.currency_locked ? null : (
    <CurrencyCard
      space={{ id: space.id, currency: { code: space.currency.code } }}
      className={hasAccounts ? undefined : "lg:flex-1"}
    />
  );
  const date = formatWeekdayDate(new Date(), space.timezone);

  if (!hasAccounts) {
    return (
      <AppShell title={title} user={user} space={space} subtitle={date} noAccounts>
        {/* Side by side from 1024 px, up to 1120 px: the main card takes two parts and the currency one. */}
        <div className="flex flex-col gap-3.5 lg:max-w-280 lg:flex-row lg:flex-wrap lg:items-stretch">
          <div className="flex min-w-0 flex-col lg:basis-130 lg:grow-2">
            <FirstUse />
          </div>
          {currencyCard ? (
            <div className="flex min-w-0 flex-col lg:basis-70 lg:grow">{currencyCard}</div>
          ) : null}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={title}
      user={user}
      space={space}
      subtitle={`${date} · así va tu mes`}
      noAccounts={false}
    >
      <HydrationBoundary state={dehydrate(queryClient)}>
        <DashboardScreen
          space={{ id: space.id, currency: space.currency }}
          currentMonth={currentMonth}
          today={today}
          currencyCard={currencyCard}
        />
      </HydrationBoundary>
    </AppShell>
  );
}

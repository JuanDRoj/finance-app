import { Plus } from "@phosphor-icons/react/ssr";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NEW_ACCOUNT_PANEL } from "@/components/accounts/panel-url";
import { AppShell } from "@/components/app-shell";
import { PrimaryActionLink } from "@/components/primary-action-link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { focusRing } from "@/components/ui/focus";
import { getServerApi } from "@/lib/api/server";
import { summarizeAccounts, splitArchived } from "@/lib/core/accounts-summary";
import { accountsQueryOptions } from "@/lib/core/data/accounts";
import { ApiError, isUnauthorized } from "@/lib/core/data/errors";
import { loadShellData } from "@/lib/core/data/shell";
import { describeApiError } from "@/lib/core/i18n";
import { formatMoney } from "@/lib/core/money";
import { cn } from "@/lib/utils";
import { AccountsScreen } from "./_components/accounts-screen";

export const metadata: Metadata = { title: "Cuentas" };

/** Only the kind of failure, never the message (see the Inicio). */
function describeFailure(error: unknown) {
  return error instanceof ApiError
    ? { status: error.status }
    : { kind: error instanceof Error ? error.name : typeof error };
}

function RetryAlert({ error }: Readonly<{ error: unknown }>) {
  const { title, message } = describeApiError(error);
  return (
    <Alert
      title={title}
      action={
        <Button
          variant="secondary"
          size="sm"
          nativeButton={false}
          render={<Link href="/cuentas" />}
        >
          Reintentar
        </Button>
      }
    >
      {message}
    </Alert>
  );
}

/**
 * "Nueva cuenta" in the header (docs/diseno.md D18): an icon of 44 px on a phone and a `primary`
 * pill with its text from 1024 px, the same element (the text is `sr-only` on a phone, so the name
 * is always "Nueva cuenta"). It opens the same panel as the sidebar button: a link to the page of the
 * form, which from 1024 px writes `?cuenta=nueva` instead of navigating.
 */
function NewAccountAction() {
  return (
    <PrimaryActionLink
      href="/cuentas/nueva"
      panel={NEW_ACCOUNT_PANEL}
      className={cn(
        "inline-flex size-11 items-center justify-center gap-2 rounded-full border border-border bg-card-solid text-primary",
        "text-item font-bold transition-[transform,filter] duration-150 ease-out active:scale-[0.97] hover:brightness-95",
        "lg:h-11.5 lg:w-auto lg:border-0 lg:bg-primary lg:px-4.5 lg:text-primary-foreground",
        focusRing,
      )}
    >
      <Plus aria-hidden weight="bold" className="size-5 lg:size-4.5" />
      <span className="sr-only lg:not-sr-only">Nueva cuenta</span>
    </PrimaryActionLink>
  );
}

/**
 * Cuentas (docs/diseno.md D18, KAN-71 / FE-17). A Server Component: it asks `/me` and `/spaces`
 * (`loadShellData`) and prefetches the accounts of the first space, archived ones included, into a
 * `QueryClient` of this request that `HydrationBoundary` hands to `AccountsScreen`.
 *
 * - No session or an expired one (401, from any call): `/login`.
 * - Any other failure of the shell data: an `Alert` with "Reintentar". A failure of the accounts is
 *   left to the client: the query is not hydrated, the screen asks again by itself and shows its
 *   own error state with "Reintentar" (never "no accounts").
 * - The subtitle of the header (from 1024 px) is the neto, computed from the same list so it always
 *   adds up with the totals of the groups; the mutations refresh the page (`router.refresh()`).
 */
export default async function AccountsPage() {
  const api = await getServerApi();
  const result = await loadShellData(api);

  if (!result.ok) {
    const { error } = result;
    if (isUnauthorized(error)) redirect("/login");
    console.error("Cuentas: could not load /me and /spaces", describeFailure(error));
    return (
      <AppShell title="Cuentas">
        <RetryAlert error={error} />
      </AppShell>
    );
  }

  const { user } = result;
  const space = result.spaces[0];
  if (!space) {
    return (
      <AppShell title="Cuentas" user={user}>
        <Alert variant="info" title="Todavía no tienes un espacio">
          Vuelve a iniciar sesión y lo preparamos por ti. Tus datos están a salvo.
        </Alert>
      </AppShell>
    );
  }

  // One QueryClient per request, never shared: these are a user's data.
  const queryClient = new QueryClient();
  const options = accountsQueryOptions(api, space.id, { includeArchived: true });
  await queryClient.prefetchQuery(options);
  const accountsError = queryClient.getQueryState(options.queryKey)?.error;
  if (isUnauthorized(accountsError)) redirect("/login");
  if (accountsError)
    console.error("Cuentas: could not load the accounts", describeFailure(accountsError));

  const accounts = queryClient.getQueryData(options.queryKey);
  const subtitle = accounts
    ? `Neto ${formatMoney(summarizeAccounts(splitArchived(accounts).active).net, space.currency)} · disponible menos deuda`
    : undefined;

  return (
    <AppShell
      title="Cuentas"
      user={user}
      space={space}
      subtitle={subtitle}
      // Only when the list loaded: if it failed the page does not know, and never takes "could not
      // load" for "no accounts" (the sheet of "Registrar" resolves it itself).
      noAccounts={accounts ? splitArchived(accounts).active.length === 0 : undefined}
      actions={<NewAccountAction />}
    >
      <HydrationBoundary state={dehydrate(queryClient)}>
        <AccountsScreen space={{ id: space.id, currency: space.currency }} />
      </HydrationBoundary>
    </AppShell>
  );
}

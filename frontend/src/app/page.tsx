import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CurrencyCard } from "@/components/currency/currency-card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getServerApi } from "@/lib/api/server";
import { listAccounts } from "@/lib/core/data/accounts";
import { ApiError, isUnauthorized } from "@/lib/core/data/errors";
import { loadShellData } from "@/lib/core/data/shell";
import { formatWeekdayDate } from "@/lib/core/dates";
import { describeApiError } from "@/lib/core/i18n";
import { displayNameOf } from "@/lib/core/user";
import { AccountsSummary } from "./_components/accounts-summary";
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
 * Home. A Server Component on purpose: the greeting is in the HTML the server sends, so there is
 * no loading state and no flash (no `loading.tsx`, no Suspense, no effects). It asks `/me` and
 * `/spaces` with the session cookie of the request (`getServerApi`), together and with the 401
 * rule of `loadShellData`, and then the accounts of the first space (it needs its id).
 *
 * - No session or an expired one (401 from any call): `/login`. The proxy of KAN-27 only sees that
 *   a cookie exists, never whether it is valid, so this check stays.
 * - Any other failure: an `Alert` in Spanish (`describeApiError`) with a way to try again. A
 *   failing accounts call is that too: the screen never takes "could not load" for "no accounts".
 * - No spaces: a notice. The backend creates the personal space together with the user, so this is
 *   not expected; the first space is the one shown (they come oldest first, the personal one
 *   first) until there is a space selector.
 * - No active accounts: the first use (docs/diseno.md D18): the invitation to create the first one.
 * - Accounts: "Tus cuentas", a first version of the dashboard's card (FE-24 replaces the page).
 * - While the space has no movements (`currency_locked` is false), the card of its currency, with
 *   "Cambiar": the same rule as the backend's, which refuses the change after the first movement.
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

  // A `try` around the call, and the `redirect` outside it: `redirect` works by throwing.
  let accounts: Awaited<ReturnType<typeof listAccounts>> | undefined;
  let accountsError: unknown;
  try {
    accounts = await listAccounts(api, space.id);
  } catch (error) {
    accountsError = error;
  }

  if (!accounts) {
    if (isUnauthorized(accountsError)) redirect("/login");
    console.error("Home: could not load the accounts", describeFailure(accountsError));
    return (
      <AppShell title={title} user={user} space={space}>
        <RetryAlert error={accountsError} />
      </AppShell>
    );
  }

  return (
    <AppShell
      title={title}
      user={user}
      space={space}
      subtitle={formatWeekdayDate(new Date(), space.timezone)}
      noAccounts={accounts.length === 0}
    >
      {/* Side by side from 1024 px, up to 1120 px: the main card takes two parts and the currency one. */}
      <div className="flex flex-col gap-3.5 lg:max-w-280 lg:flex-row lg:flex-wrap lg:items-stretch">
        <div className="flex min-w-0 flex-col lg:basis-130 lg:grow-2">
          {accounts.length === 0 ? (
            <FirstUse />
          ) : (
            <AccountsSummary accounts={accounts} currency={space.currency} />
          )}
        </div>
        {space.currency_locked ? null : (
          <div className="flex min-w-0 flex-col lg:basis-70 lg:grow">
            <CurrencyCard
              space={{ id: space.id, currency: { code: space.currency.code } }}
              className="lg:flex-1"
            />
          </div>
        )}
      </div>
    </AppShell>
  );
}

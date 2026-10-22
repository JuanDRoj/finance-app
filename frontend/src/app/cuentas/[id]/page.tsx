import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BackLink } from "@/components/back-link";
import { DesktopRedirect } from "@/components/desktop-redirect";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getServerApi } from "@/lib/api/server";
import { getAccount } from "@/lib/core/data/accounts";
import { ApiError, isUnauthorized } from "@/lib/core/data/errors";
import { loadShellData } from "@/lib/core/data/shell";
import { describeApiError } from "@/lib/core/i18n";
import { EditAccountPage } from "./_components/edit-account-page";

export const metadata: Metadata = { title: "Editar cuenta" };

/** Only the kind of failure, never the message (see the Inicio). */
function describeFailure(error: unknown) {
  return error instanceof ApiError
    ? { status: error.status }
    : { kind: error instanceof Error ? error.name : typeof error };
}

/**
 * The page of an account, for phones and tablets (docs/diseno.md D18): "Editar cuenta" with
 * "Más acciones" (Cuadrar saldo, Archivar cuenta). From 1024 px the account lives in the list and its
 * panels, so `DesktopRedirect` sends the visitor to `/cuentas?sel=<id>` (and `phoneOnly` hides the
 * column meanwhile, as in `/cuentas/nueva`). No bottom bar: the keyboard needs the room.
 *
 * - No session or an expired one (401): `/login`. Any other failure of the shell data: an `Alert`.
 * - An account that does not exist, is not the user's or is archived: an `Alert` with a way back to
 *   Cuentas (an archived one is unarchived from the list; its form would only fail).
 */
export default async function AccountPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const api = await getServerApi();
  const result = await loadShellData(api);
  const desktopRedirect = <DesktopRedirect to={`/cuentas?sel=${encodeURIComponent(id)}`} />;

  if (!result.ok) {
    const { error } = result;
    if (isUnauthorized(error)) redirect("/login");
    console.error("Cuenta: could not load /me and /spaces", describeFailure(error));
    const { title, message } = describeApiError(error);
    return (
      <AppShell
        title="Editar cuenta"
        hideBottomNav
        phoneOnly
        leading={<BackLink fallbackHref="/cuentas" />}
      >
        {desktopRedirect}
        <Alert
          title={title}
          action={
            <Button
              variant="secondary"
              size="sm"
              nativeButton={false}
              render={<Link href={`/cuentas/${encodeURIComponent(id)}`} />}
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
      <AppShell
        title="Editar cuenta"
        user={user}
        hideBottomNav
        phoneOnly
        leading={<BackLink fallbackHref="/cuentas" />}
      >
        {desktopRedirect}
        <Alert variant="info" title="Todavía no tienes un espacio">
          Vuelve a iniciar sesión y lo preparamos por ti. Tus datos están a salvo.
        </Alert>
      </AppShell>
    );
  }

  // A `try` around the call, and the `redirect` outside it: `redirect` works by throwing.
  let account: Awaited<ReturnType<typeof getAccount>> | undefined;
  let accountError: unknown;
  try {
    account = await getAccount(api, space.id, id);
  } catch (error) {
    accountError = error;
  }
  if (!account && isUnauthorized(accountError)) redirect("/login");

  if (!account || account.archived_at !== null) {
    // A 404 (or an id that is not even an id: 422) and an archived account read the same: not there.
    const notThere =
      !accountError ||
      (accountError instanceof ApiError && [404, 422].includes(accountError.status));
    if (!notThere)
      console.error("Cuenta: could not load the account", describeFailure(accountError));
    const { title, message } = describeApiError(
      notThere ? new ApiError(404, { code: "account_not_found", detail: "" }) : accountError,
    );
    return (
      <AppShell
        title="Editar cuenta"
        user={user}
        space={space}
        hideBottomNav
        phoneOnly
        leading={<BackLink fallbackHref="/cuentas" />}
      >
        {desktopRedirect}
        <Alert
          title={title}
          action={
            <Button
              variant="secondary"
              size="sm"
              nativeButton={false}
              render={<Link href="/cuentas" />}
            >
              Ir a Cuentas
            </Button>
          }
        >
          {message}
        </Alert>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Editar cuenta"
      user={user}
      space={space}
      hideBottomNav
      phoneOnly
      leading={<BackLink fallbackHref="/cuentas" />}
    >
      {desktopRedirect}
      <EditAccountPage account={account} space={{ id: space.id, currency: space.currency }} />
    </AppShell>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BackLink } from "@/components/back-link";
import { DesktopRedirect } from "@/components/desktop-redirect";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getServerApi } from "@/lib/api/server";
import { ApiError, isUnauthorized } from "@/lib/core/data/errors";
import { loadShellData } from "@/lib/core/data/shell";
import { describeApiError } from "@/lib/core/i18n";
import { NewAccountPageForm } from "./_components/new-account-page-form";

export const metadata: Metadata = { title: "Nueva cuenta" };

// Where a desktop visitor goes: the Inicio with the side panel open over it (`?cuenta=nueva`, read by
// `AccountPanelHost`). FE-17 points it at Cuentas, which is where the panel opens over the list.
const DESKTOP_DESTINATION = "/?cuenta=nueva";

/**
 * The form of a new account as a page (docs/diseno.md D18), for phones and tablets: below 1024 px
 * the "+" of the bottom bar and "Crear mi primera cuenta" lead here. From 1024 px the form is the
 * side panel over the current screen, so `DesktopRedirect` sends the visitor to the Inicio with the
 * panel open (and `phoneOnly` hides the page's content column meanwhile, as in "Más").
 *
 * - No bottom bar (`hideBottomNav`): the keyboard needs the room.
 * - No session or an expired one (401): `/login`, as on the Inicio.
 * - Any other failure of `/me` or `/spaces`: an `Alert` in Spanish with a way to try again.
 * - Without a space (it should not happen: the backend creates the personal one with the user): a
 *   notice, not a form that would have nowhere to create the account.
 */
export default async function NewAccountPage() {
  const result = await loadShellData(await getServerApi());

  if (!result.ok) {
    const { error } = result;
    if (isUnauthorized(error)) redirect("/login");

    // Only the kind of failure, never the message (see the Inicio).
    console.error(
      "Nueva cuenta: could not load /me and /spaces",
      error instanceof ApiError
        ? { status: error.status }
        : { kind: error instanceof Error ? error.name : typeof error },
    );
    const { title, message } = describeApiError(error);
    return (
      <AppShell title="Nueva cuenta" hideBottomNav phoneOnly leading={<BackLink />}>
        <DesktopRedirect to={DESKTOP_DESTINATION} />
        <Alert
          title={title}
          action={
            <Button
              variant="secondary"
              size="sm"
              nativeButton={false}
              render={<Link href="/cuentas/nueva" />}
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

  const space = result.spaces[0];

  return (
    <AppShell
      title="Nueva cuenta"
      user={result.user}
      space={space}
      hideBottomNav
      phoneOnly
      leading={<BackLink />}
    >
      <DesktopRedirect to={DESKTOP_DESTINATION} />
      {space ? (
        <Card variant="solid" className="gap-4 p-4.5">
          <NewAccountPageForm space={{ id: space.id, currency: space.currency }} />
        </Card>
      ) : (
        <Alert variant="info" title="Todavía no tienes un espacio">
          Vuelve a iniciar sesión y lo preparamos por ti. Tus datos están a salvo.
        </Alert>
      )}
    </AppShell>
  );
}

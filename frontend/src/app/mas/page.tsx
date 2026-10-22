import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DesktopRedirect } from "@/components/desktop-redirect";
import { MoreList } from "@/components/more-list";
import { MORE_SECTIONS } from "@/components/nav-sections";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getServerApi } from "@/lib/api/server";
import { ApiError, isUnauthorized } from "@/lib/core/data/errors";
import { loadShellData } from "@/lib/core/data/shell";
import { describeApiError } from "@/lib/core/i18n";

export const metadata: Metadata = { title: "Más" };

/**
 * "Más" (docs/diseno.md D17 › Navegación del Hito 1): the screen behind the last tab of the bottom
 * bar, for phones and tablets. It lists what hangs from "Más" (`MORE_SECTIONS`: Categorías in
 * Hito 1). From 1024 px those options are already in the sidebar, so `DesktopRedirect` sends the
 * visitor to `/` (and `phoneOnly` hides the whole content column, the `h1` included, meanwhile).
 *
 * - Nothing hangs from "Más" yet (no Categorías screen): there is nothing to show, so `/`. The tab
 *   itself is not drawn in that case.
 * - No session or an expired one (401): `/login`, as on the home.
 * - Any other failure of `/me` or `/spaces`: an `Alert` in Spanish with a way to try again.
 */
export default async function MorePage() {
  if (MORE_SECTIONS.length === 0) redirect("/");

  const result = await loadShellData(await getServerApi());

  if (!result.ok) {
    const { error } = result;
    if (isUnauthorized(error)) redirect("/login");

    // Only the kind of failure, never the message (see the home).
    console.error(
      "Más: could not load /me and /spaces",
      error instanceof ApiError
        ? { status: error.status }
        : { kind: error instanceof Error ? error.name : typeof error },
    );
    const { title, message } = describeApiError(error);
    return (
      <AppShell title="Más">
        <Alert
          title={title}
          action={
            <Button
              variant="secondary"
              size="sm"
              nativeButton={false}
              render={<Link href="/mas" />}
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

  return (
    <AppShell title="Más" user={result.user} space={result.spaces[0]} phoneOnly>
      <DesktopRedirect />
      <MoreList sections={MORE_SECTIONS} />
    </AppShell>
  );
}

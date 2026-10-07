import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getServerApi } from "@/lib/api/server";
import { ApiError } from "@/lib/core/data/errors";
import { getMe } from "@/lib/core/data/me";
import { listSpaces } from "@/lib/core/data/spaces";
import { describeApiError } from "@/lib/core/i18n";
import { displayNameOf } from "@/lib/core/user";

export const metadata: Metadata = { title: "Inicio" };

/**
 * Both calls are independent, so they run together. The failure is returned, not thrown, so that
 * `redirect()` (which works by throwing) is never called inside a `try`.
 */
async function loadHome() {
  const api = await getServerApi();
  try {
    const [user, spaces] = await Promise.all([getMe(api), listSpaces(api)]);
    return { ok: true as const, user, spaces };
  } catch (error) {
    return { ok: false as const, error };
  }
}

/**
 * Home. A Server Component on purpose: the greeting is in the HTML the server sends, so there is
 * no loading state and no flash (no `loading.tsx`, no Suspense, no effects). It asks `/me` and
 * `/spaces` with the session cookie of the request (`getServerApi`).
 *
 * - No session or an expired one (401): `/login`. The proxy of KAN-27 only sees that a cookie
 *   exists, never whether it is valid, so this check stays.
 * - Any other failure: an `Alert` in Spanish (`describeApiError`) with a way to try again.
 * - No spaces: a notice. The backend creates the personal space together with the user, so this
 *   is not expected; the first space is the one shown (they come oldest first, the personal one
 *   first) until there is a space selector.
 */
export default async function HomePage() {
  const result = await loadHome();

  if (!result.ok) {
    const { error } = result;
    if (error instanceof ApiError && error.status === 401) redirect("/login");

    // Only the kind of failure: nothing from the request or the user goes into the log.
    console.error(
      "Home: could not load /me and /spaces",
      error instanceof ApiError ? { status: error.status } : { kind: String(error) },
    );
    const { title, message } = describeApiError(error);
    return (
      <AppShell title="Inicio">
        <Alert
          title={title}
          action={
            // A link to `/` itself: the dynamic page is rendered again and asks the backend again.
            <Button variant="secondary" size="sm" nativeButton={false} render={<Link href="/" />}>
              Reintentar
            </Button>
          }
        >
          {message}
        </Alert>
      </AppShell>
    );
  }

  const name = displayNameOf(result.user);
  const space = result.spaces[0];

  return (
    <AppShell title="Inicio">
      <div className="flex flex-col gap-4">
        {space ? (
          <Card>
            <p className="text-lg leading-snug wrap-anywhere">
              Hola, <strong className="font-bold">{name}</strong>, tu espacio es{" "}
              <strong className="font-bold">{space.name}</strong>.
            </p>
          </Card>
        ) : (
          <>
            <Card>
              <p className="text-lg leading-snug wrap-anywhere">
                Hola, <strong className="font-bold">{name}</strong>.
              </p>
            </Card>
            <Alert variant="info" title="Todavía no tienes un espacio">
              Vuelve a iniciar sesión y lo preparamos por ti. Tus datos están a salvo.
            </Alert>
          </>
        )}
      </div>
    </AppShell>
  );
}

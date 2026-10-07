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

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/**
 * Both calls are independent, so they run together, and both are awaited to the end
 * (`allSettled`), so the outcome does not depend on which one fails first. The failure is
 * returned, not thrown, so that `redirect()` (which works by throwing) is never called inside a
 * `try`. A 401 from either call wins over any other failure of the other one (the session is
 * gone, and `/login` is the answer); without a 401, the first failure is the one reported,
 * `/me` before `/spaces`.
 */
async function loadHome() {
  const api = await getServerApi();
  const [me, spaces] = await Promise.allSettled([getMe(api), listSpaces(api)]);

  if (me.status === "fulfilled" && spaces.status === "fulfilled") {
    return { ok: true as const, user: me.value, spaces: spaces.value };
  }

  const failures: unknown[] = [];
  if (me.status === "rejected") failures.push(me.reason);
  if (spaces.status === "rejected") failures.push(spaces.reason);
  return { ok: false as const, error: failures.find(isUnauthorized) ?? failures[0] };
}

/**
 * Home. A Server Component on purpose: the greeting is in the HTML the server sends, so there is
 * no loading state and no flash (no `loading.tsx`, no Suspense, no effects). It asks `/me` and
 * `/spaces` with the session cookie of the request (`getServerApi`).
 *
 * - No session or an expired one (401 from `/me` or from `/spaces`): `/login`. The proxy of KAN-27
 *   only sees that a cookie exists, never whether it is valid, so this check stays.
 * - Any other failure: an `Alert` in Spanish (`describeApiError`) with a way to try again.
 * - No spaces: a notice. The backend creates the personal space together with the user, so this
 *   is not expected; the first space is the one shown (they come oldest first, the personal one
 *   first) until there is a space selector.
 */
export default async function HomePage() {
  const result = await loadHome();

  if (!result.ok) {
    const { error } = result;
    if (isUnauthorized(error)) redirect("/login");

    // Only the kind of failure: the status of an `ApiError`, or the name of any other error.
    // Never its message (a parse error can quote a piece of the response body) nor the request.
    console.error(
      "Home: could not load /me and /spaces",
      error instanceof ApiError
        ? { status: error.status }
        : { kind: error instanceof Error ? error.name : typeof error },
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

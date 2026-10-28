import type { Metadata } from "next";
import Link from "next/link";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BackLink } from "@/components/back-link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getServerApi } from "@/lib/api/server";
import { categoriesQueryOptions } from "@/lib/core/data/categories";
import { ApiError, isUnauthorized } from "@/lib/core/data/errors";
import { loadShellData } from "@/lib/core/data/shell";
import { describeApiError } from "@/lib/core/i18n";
import { CategoriesScreen } from "./_components/categories-screen";
import { NewCategoryAction } from "./_components/new-category-action";

export const metadata: Metadata = { title: "Categorías" };

const SUBTITLE = "Agrupa tus gastos e ingresos en dos niveles";

/** Only the kind of failure, never the message (see the Inicio). */
function describeFailure(error: unknown) {
  return error instanceof ApiError
    ? { status: error.status }
    : { kind: error instanceof Error ? error.name : typeof error };
}

/** "Volver" to «Más», only below 1024 px: on desktop Categorías is in the sidebar and nothing is behind it. */
const back = <BackLink fallbackHref="/mas" className="lg:hidden" />;

/**
 * Categorías (docs/diseno.md D19, KAN-77 / FE-21). A Server Component: it asks `/me` and `/spaces`
 * (`loadShellData`) and prefetches the categories of the first space, archived ones included, into a
 * `QueryClient` of this request that `HydrationBoundary` hands to `CategoriesScreen`.
 *
 * - No session or an expired one (401, from any call): `/login`.
 * - Any other failure of the shell data: an `Alert` with "Reintentar". A failure of the categories is
 *   left to the client: the query is not hydrated, the screen asks again by itself and shows its own
 *   error state with "Reintentar" (never "no categories").
 * - On a phone it is a subpage of «Más»: "Volver", the title, the "+" and the avatar, with the bottom
 *   bar and «Más» active. From 1024 px it is an entry at the bottom of the sidebar, with the line
 *   "Agrupa tus gastos e ingresos en dos niveles" and the pill "Nueva categoría". It does not pass
 *   `noAccounts` to the shell: it does not know about the accounts, and «Registrar» resolves it.
 */
export default async function CategoriesPage() {
  const api = await getServerApi();
  const result = await loadShellData(api);

  if (!result.ok) {
    const { error } = result;
    if (isUnauthorized(error)) redirect("/login");
    console.error("Categorías: could not load /me and /spaces", describeFailure(error));
    const { title, message } = describeApiError(error);
    return (
      <AppShell title="Categorías" leading={back}>
        <Alert
          title={title}
          action={
            <Button
              variant="secondary"
              size="sm"
              nativeButton={false}
              render={<Link href="/categorias" />}
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
      <AppShell title="Categorías" user={user} leading={back}>
        <Alert variant="info" title="Todavía no tienes un espacio">
          Vuelve a iniciar sesión y lo preparamos por ti. Tus datos están a salvo.
        </Alert>
      </AppShell>
    );
  }

  // One QueryClient per request, never shared: these are a user's data.
  const queryClient = new QueryClient();
  const options = categoriesQueryOptions(api, space.id, { includeArchived: true });
  await queryClient.prefetchQuery(options);
  const categoriesError = queryClient.getQueryState(options.queryKey)?.error;
  if (isUnauthorized(categoriesError)) redirect("/login");
  if (categoriesError) {
    console.error("Categorías: could not load the categories", describeFailure(categoriesError));
  }

  return (
    <AppShell
      title="Categorías"
      user={user}
      space={space}
      subtitle={SUBTITLE}
      leading={back}
      actions={<NewCategoryAction />}
    >
      <HydrationBoundary state={dehydrate(queryClient)}>
        <CategoriesScreen space={{ id: space.id, timezone: space.timezone }} />
      </HydrationBoundary>
    </AppShell>
  );
}

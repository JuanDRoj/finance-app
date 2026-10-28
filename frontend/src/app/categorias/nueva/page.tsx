import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BackLink } from "@/components/back-link";
import { newCategoryPageHref, newCategoryPanelHref } from "@/components/categories/category-urls";
import { DesktopRedirect } from "@/components/desktop-redirect";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getServerApi } from "@/lib/api/server";
import { categoryKindFromParam } from "@/lib/core/categories";
import { listCategories, type CategoryRead } from "@/lib/core/data/categories";
import { ApiError, isUnauthorized } from "@/lib/core/data/errors";
import { loadShellData } from "@/lib/core/data/shell";
import { describeApiError } from "@/lib/core/i18n";
import { NewCategoryPageForm } from "./_components/new-category-page-form";

export const metadata: Metadata = { title: "Nueva categoría" };

/** Only the kind of failure, never the message (see the Inicio). */
function describeFailure(error: unknown) {
  return error instanceof ApiError
    ? { status: error.status }
    : { kind: error instanceof Error ? error.name : typeof error };
}

/** A query param as text: the first one if it is repeated. */
function textOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The form of a new category as a page (docs/diseno.md D19), for phones and tablets: the "+" of
 * Categorías, "Crear categoría" and "Agregar subcategoría" lead here, with `?tipo=gastos|ingresos`
 * (the kind it starts on) and `?padre=<id>` (the principal it starts in). From 1024 px the form is the
 * side panel over Categorías, so `DesktopRedirect` sends the visitor to `/categorias?categoria=nueva`
 * with the same params (and `phoneOnly` hides the content column meanwhile, as in `/cuentas/nueva`).
 *
 * - No bottom bar (`hideBottomNav`): the keyboard needs the room, and the button is fixed at the bottom.
 * - No session or an expired one (401): `/login`. Any other failure, of the shell data or of the
 *   categories: an `Alert` with "Reintentar". Without a space: a notice.
 * - A `tipo` or a `padre` that is not valid is ignored by the form (it starts as a principal expense
 *   category): the link may be old.
 */
export default async function NewCategoryPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ tipo?: string | string[]; padre?: string | string[] }> }>) {
  const query = await searchParams;
  const kind = categoryKindFromParam(textOf(query.tipo));
  const parentId = textOf(query.padre) || undefined;
  const start = { kind, parentId };
  const here = newCategoryPageHref(start);
  const desktop = <DesktopRedirect to={newCategoryPanelHref(start)} />;
  const shell = { title: "Nueva categoría", hideBottomNav: true, phoneOnly: true } as const;
  const leading = <BackLink fallbackHref="/categorias" />;

  function failure(
    error: unknown,
    user?: Parameters<typeof AppShell>[0]["user"],
    space?: Parameters<typeof AppShell>[0]["space"],
  ) {
    const { title, message } = describeApiError(error);
    return (
      <AppShell {...shell} user={user} space={space} leading={leading}>
        {desktop}
        <Alert
          title={title}
          action={
            <Button
              variant="secondary"
              size="sm"
              nativeButton={false}
              render={<Link href={here} />}
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

  const api = await getServerApi();
  const result = await loadShellData(api);
  if (!result.ok) {
    if (isUnauthorized(result.error)) redirect("/login");
    console.error("Nueva categoría: could not load /me and /spaces", describeFailure(result.error));
    return failure(result.error);
  }

  const { user } = result;
  const space = result.spaces[0];
  if (!space) {
    return (
      <AppShell {...shell} user={user} leading={leading}>
        {desktop}
        <Alert variant="info" title="Todavía no tienes un espacio">
          Vuelve a iniciar sesión y lo preparamos por ti. Tus datos están a salvo.
        </Alert>
      </AppShell>
    );
  }

  // A `try` around the call, and the `redirect` outside it: `redirect` works by throwing.
  let categories: CategoryRead[] | undefined;
  let categoriesError: unknown;
  try {
    categories = await listCategories(api, space.id, { includeArchived: true });
  } catch (error) {
    categoriesError = error;
  }
  if (!categories) {
    if (isUnauthorized(categoriesError)) redirect("/login");
    console.error(
      "Nueva categoría: could not load the categories",
      describeFailure(categoriesError),
    );
    return failure(categoriesError, user, space);
  }

  return (
    <AppShell {...shell} user={user} space={space} leading={leading}>
      {desktop}
      <NewCategoryPageForm
        space={{ id: space.id }}
        categories={categories}
        defaults={{ kind, parentId }}
      />
    </AppShell>
  );
}

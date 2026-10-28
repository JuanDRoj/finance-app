import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BackLink } from "@/components/back-link";
import { editCategoryPageHref, editCategoryPanelHref } from "@/components/categories/category-urls";
import { DesktopRedirect } from "@/components/desktop-redirect";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getServerApi } from "@/lib/api/server";
import { findCategory } from "@/lib/core/categories";
import { listCategories, type CategoryRead } from "@/lib/core/data/categories";
import { ApiError, isUnauthorized } from "@/lib/core/data/errors";
import { loadShellData } from "@/lib/core/data/shell";
import { describeApiError } from "@/lib/core/i18n";
import { EditCategoryPage } from "./_components/edit-category-page";

export const metadata: Metadata = { title: "Editar categoría" };

/** Only the kind of failure, never the message (see the Inicio). */
function describeFailure(error: unknown) {
  return error instanceof ApiError
    ? { status: error.status }
    : { kind: error instanceof Error ? error.name : typeof error };
}

/**
 * The page of a category, for phones and tablets (docs/diseno.md D19): "Editar categoría" with its
 * note, the name, the icon and "Más acciones" (Archivar categoría). From 1024 px the category lives in
 * the list and its panel, so `DesktopRedirect` sends the visitor to `/categorias?categoria=editar&id=<id>`
 * (and `phoneOnly` hides the column meanwhile, as in `/cuentas/[id]`). No bottom bar: the keyboard
 * needs the room.
 *
 * - No session or an expired one (401): `/login`. Any other failure: an `Alert` with "Reintentar".
 * - The category comes from the list of the space (there is no endpoint for one), archived ones
 *   included. One that is not in it, or is archived, gets an `Alert` "No encontramos esa categoría"
 *   with a way back to Categorías (an archived one is unarchived from the list; its form would only fail).
 */
export default async function CategoryPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const desktop = <DesktopRedirect to={editCategoryPanelHref(id)} />;
  const shell = { title: "Editar categoría", hideBottomNav: true, phoneOnly: true } as const;
  const leading = <BackLink fallbackHref="/categorias" />;
  const api = await getServerApi();
  const result = await loadShellData(api);

  if (!result.ok) {
    const { error } = result;
    if (isUnauthorized(error)) redirect("/login");
    console.error("Categoría: could not load /me and /spaces", describeFailure(error));
    const { title, message } = describeApiError(error);
    return (
      <AppShell {...shell} leading={leading}>
        {desktop}
        <Alert
          title={title}
          action={
            <Button
              variant="secondary"
              size="sm"
              nativeButton={false}
              render={<Link href={editCategoryPageHref(id)} />}
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
    console.error("Categoría: could not load the categories", describeFailure(categoriesError));
    const { title, message } = describeApiError(categoriesError);
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
              render={<Link href={editCategoryPageHref(id)} />}
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

  const category = findCategory(categories, id);
  if (!category || category.archived_at !== null) {
    // Gone and archived read the same: not there to edit.
    const { title, message } = describeApiError(
      new ApiError(404, { code: "category_not_found", detail: "" }),
    );
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
              render={<Link href="/categorias" />}
            >
              Ir a Categorías
            </Button>
          }
        >
          {message}
        </Alert>
      </AppShell>
    );
  }

  return (
    <AppShell {...shell} user={user} space={space} leading={leading}>
      {desktop}
      <EditCategoryPage category={category} categories={categories} space={{ id: space.id }} />
    </AppShell>
  );
}

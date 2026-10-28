"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { CategoryPanelHost } from "@/components/categories/category-panel";
import { browserApi } from "@/lib/api/browser";
import { buildCategoryTree, categoryKindFromParam } from "@/lib/core/categories";
import type { ApiClient } from "@/lib/core/data/api-client";
import { categoriesQueryOptions } from "@/lib/core/data/categories";
import { ArchivedCategories } from "./archived-categories";
import { CategoriesError } from "./categories-error";
import { CategoriesSkeleton } from "./categories-skeleton";
import { CategoryCard } from "./category-card";
import { KindTabs } from "./kind-tabs";

type CategoriesScreenProps = {
  /** The space: its id, and its time zone (the day an archived category was archived is the space's). */
  space: { id: string; timezone: string };
  /** The API client; the browser's by default (the catalog and the tests pass a scripted one). */
  api?: ApiClient;
};

/**
 * The body of Categorías (docs/diseno.md D19): the categories of each kind in two levels, with
 * "Archivadas (n)" at the end. One query with the archived categories included (the server
 * prefetched it and the page hydrates it); the active ones, the archived ones and the counts are
 * told apart here, and every mutation invalidates the root of the categories of the space.
 *
 * - **Phone:** the segmented control Gastos · Ingresos (`?tipo=gastos|ingresos`, gastos if none)
 *   chooses the kind on show, and each principal is a card. **Desktop:** both kinds, side by side.
 * - Loading: a skeleton. Error: "No se pudieron cargar tus categorías" with "Reintentar"; a failed
 *   load is never taken for "no categories". A kind with no active category shows its own empty state.
 * - It mounts `CategoryPanelHost`, in every state (it asks for its own list, and needs the screen to
 *   be there), so `?categoria=nueva|editar` opens the side panel from 1024 px.
 */
export function CategoriesScreen({ space, api = browserApi }: CategoriesScreenProps) {
  const searchParams = useSearchParams();
  const query = useQuery(categoriesQueryOptions(api, space.id, { includeArchived: true }));
  const visibleKind = categoryKindFromParam(searchParams.get("tipo")) ?? "expense";

  const trees = useMemo(
    () =>
      query.data && {
        expense: buildCategoryTree(query.data, "expense"),
        income: buildCategoryTree(query.data, "income"),
      },
    [query.data],
  );

  let body;
  if (!query.data || !trees) {
    body = query.isError ? (
      <CategoriesError onRetry={() => void query.refetch()} busy={query.isFetching} />
    ) : (
      <CategoriesSkeleton />
    );
  } else {
    body = (
      <div className="flex flex-col gap-3.5 lg:gap-4.5">
        <KindTabs kind={visibleKind} />
        <div className="flex flex-col gap-3.5 lg:flex-row lg:flex-wrap lg:items-start lg:gap-4.5">
          <CategoryCard
            kind="expense"
            tree={trees.expense}
            visible={visibleKind === "expense"}
            spaceId={space.id}
            api={api}
          />
          <CategoryCard
            kind="income"
            tree={trees.income}
            visible={visibleKind === "income"}
            spaceId={space.id}
            api={api}
          />
        </div>
        <ArchivedCategories
          categories={query.data}
          visibleKind={visibleKind}
          space={space}
          api={api}
        />
      </div>
    );
  }

  return (
    <>
      {body}
      <CategoryPanelHost space={space} api={api} />
    </>
  );
}

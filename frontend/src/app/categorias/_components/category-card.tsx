import { Plus } from "@phosphor-icons/react/ssr";
import { useId } from "react";
import { CATEGORY_PANEL } from "@/components/accounts/panel-url";
import { newCategoryPageHref } from "@/components/categories/category-urls";
import { PrimaryActionLink } from "@/components/primary-action-link";
import { focusRing } from "@/components/ui/focus";
import { describeCategoryCounts, type CategoryBranch } from "@/lib/core/categories";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { CategoryKind } from "@/lib/core/data/categories";
import { CATEGORY_KIND_PLURAL_NAMES } from "@/lib/core/i18n";
import { cn } from "@/lib/utils";
import { CategoriesEmpty } from "./categories-empty";
import { CategoryRow } from "./category-row";

type CategoryCardProps = {
  kind: CategoryKind;
  /** The active principals of the kind with their active subcategories (`buildCategoryTree`). */
  tree: readonly CategoryBranch[];
  /** The kind the segmented control shows (a phone lists one kind); both are shown from 1024 px. */
  visible: boolean;
  spaceId: string;
  api?: ApiClient;
};

/**
 * The categories of one kind (docs/diseno.md D19). From 1024 px it is a solid card (Gastos 520 px
 * of base and Ingresos 360, side by side and wrapping to one column at 1024 px) with its title, the
 * counts ("9 principales · 13 subcategorías") and the rows. On a phone there is no card around the
 * kind: each principal with its subcategories is a glass card of its own, the title is only for
 * screen readers, and the kind that is not chosen is `display: none`.
 *
 * Each principal ends, on a phone, with the row "Agregar subcategoría" (its `aria-label` names the
 * principal); on desktop it is the "+" in the actions of the row. A kind with no active category
 * shows `CategoriesEmpty` in its place.
 */
export function CategoryCard({ kind, tree, visible, spaceId, api }: CategoryCardProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "flex min-w-0 flex-col gap-3.5 lg:gap-0 lg:rounded-card lg:border lg:border-border lg:bg-surface lg:p-5",
        kind === "expense" ? "lg:basis-130 lg:grow-3" : "lg:basis-90 lg:grow-2",
        !visible && "max-lg:hidden",
      )}
    >
      <div className="flex items-baseline justify-between gap-3 max-lg:contents lg:px-1 lg:pb-2">
        <h2 id={headingId} tabIndex={-1} className="font-heading text-lg font-bold max-lg:sr-only">
          {CATEGORY_KIND_PLURAL_NAMES[kind]}
        </h2>
        <span className="text-sm text-muted-foreground max-lg:hidden">
          {describeCategoryCounts(tree)}
        </span>
      </div>
      {tree.length === 0 ? (
        <CategoriesEmpty kind={kind} />
      ) : (
        <ul className="flex flex-col gap-3.5 lg:gap-0">
          {tree.map(({ principal, subs }) => (
            <li
              key={principal.id}
              className="min-w-0 max-lg:card-surface max-lg:overflow-hidden max-lg:rounded-tile lg:not-first:border-t lg:not-first:border-border"
            >
              <CategoryRow
                category={principal}
                level="principal"
                subCount={subs.length}
                spaceId={spaceId}
                headingId={headingId}
                api={api}
              />
              {subs.length > 0 ? (
                <ul aria-label={`Subcategorías de ${principal.name}`} className="flex flex-col">
                  {subs.map((sub) => (
                    <li key={sub.id} className="border-t border-border lg:border-t-0">
                      <CategoryRow
                        category={sub}
                        level="sub"
                        spaceId={spaceId}
                        headingId={headingId}
                        api={api}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="border-t border-border lg:hidden">
                <PrimaryActionLink
                  href={newCategoryPageHref({ parentId: principal.id })}
                  panel={{ ...CATEGORY_PANEL, extra: { padre: principal.id } }}
                  // The visible text is the start of the name (WCAG 2.5.3): which principal is in it.
                  aria-label={`Agregar subcategoría a ${principal.name}`}
                  className={cn(
                    "flex min-h-12 items-center gap-2.5 pr-3.5 pl-10 text-sm font-bold text-primary select-none",
                    "transition-colors duration-150 ease-out hover:bg-accent active:bg-accent",
                    focusRing,
                    "focus-visible:-outline-offset-2",
                  )}
                >
                  <Plus aria-hidden weight="bold" className="size-4 shrink-0" />
                  <span className="min-w-0">Agregar subcategoría</span>
                </PrimaryActionLink>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

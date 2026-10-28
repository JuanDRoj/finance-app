import { CaretRight } from "@phosphor-icons/react/ssr";
import { CategoryIcon } from "@/components/category-icon";
import { categoryEditPanel } from "@/components/accounts/panel-url";
import { editCategoryPageHref } from "@/components/categories/category-urls";
import { PrimaryActionLink } from "@/components/primary-action-link";
import { focusRing } from "@/components/ui/focus";
import { describeSubcategoryCount } from "@/lib/core/categories";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { CategoryRead } from "@/lib/core/data/categories";
import { cn } from "@/lib/utils";
import { RowActions } from "./row-actions";

type CategoryRowProps = {
  category: CategoryRead;
  level: "principal" | "sub";
  /** For a principal: how many active subcategories it has (its line under the name). */
  subCount?: number;
  spaceId: string;
  headingId: string;
  api?: ApiClient;
};

/**
 * A row of the list of Categorías (docs/diseno.md D19; K-H1-Categorias and K-V2-Escritorio): the icon
 * in its tile, the name and, for a principal, "3 subcategorías". One markup for both widths.
 *
 * - **Phone:** a principal is 64 px with a 42 px tile and "Sin subcategorías" when it has none; a
 *   subcategory is 52 px, indented, with a 32 px tile. All of it is one link to the page of the
 *   category (`/categorias/<id>`), with a chevron.
 * - **Desktop:** 52 px and 44 px rows, tiles of 36 and 28 px, the line only when there are
 *   subcategories, no chevron, and the actions on the right (`RowActions`). The name is a link too:
 *   a plain click opens the edit panel instead of navigating.
 *
 * A name may have 80 characters, so it wraps (two lines, anywhere: there may be no space to break at)
 * and the whole name is in `title`.
 */
export function CategoryRow({
  category,
  level,
  subCount = 0,
  spaceId,
  headingId,
  api,
}: CategoryRowProps) {
  const principal = level === "principal";
  return (
    <div
      className={cn(
        "flex items-center",
        principal ? "min-h-16 lg:min-h-13" : "min-h-13 lg:min-h-11",
      )}
    >
      <PrimaryActionLink
        href={editCategoryPageHref(category.id)}
        panel={categoryEditPanel(category.id)}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 self-stretch py-1.5 pr-2 select-none",
          principal ? "pl-3.5 lg:pl-1.5" : "pl-8.5 lg:pl-11.5",
          "transition-colors duration-150 ease-out hover:bg-accent active:bg-accent lg:rounded-xl",
          // Inside the glass card of a phone (`overflow-hidden`) an outside ring would be cut off.
          focusRing,
          "focus-visible:-outline-offset-2",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "flex shrink-0 items-center justify-center rounded-icon bg-secondary text-primary",
            principal ? "size-10.5 lg:size-9" : "size-8 lg:size-7",
          )}
        >
          <CategoryIcon
            icon={category.icon}
            className={principal ? "size-5.5 lg:size-5" : "size-4.5 lg:size-4"}
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            title={category.name}
            className={cn(
              "line-clamp-2 text-item wrap-anywhere",
              principal ? "font-bold" : "font-semibold",
            )}
          >
            {category.name}
          </span>
          {principal ? (
            <span
              className={cn("text-caption text-muted-foreground", subCount === 0 && "lg:hidden")}
            >
              {describeSubcategoryCount(subCount)}
            </span>
          ) : null}
        </span>
        <CaretRight aria-hidden className="size-4.5 shrink-0 text-muted-foreground lg:hidden" />
      </PrimaryActionLink>
      <RowActions
        category={category}
        isPrincipal={principal}
        spaceId={spaceId}
        headingId={headingId}
        api={api}
      />
    </div>
  );
}

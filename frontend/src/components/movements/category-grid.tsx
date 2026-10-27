"use client";

import { useId, type Ref } from "react";
import { CategoryIcon } from "@/components/category-icon";
import { FieldError } from "@/components/ui/field";
import { focusRing } from "@/components/ui/focus";
import {
  describeCategoryChoice,
  findCategoryPlace,
  type CategoryBranch,
} from "@/lib/core/categories";
import { cn } from "@/lib/utils";

type CategoryGridProps = {
  /** The principals of the kind of the movement with their subcategories (`buildCategoryTree`). */
  tree: readonly CategoryBranch[];
  /** The id of the chosen category (a principal or a subcategory), or `""`. */
  value: string;
  /** A principal with no subcategories was chosen, or one with subcategories before its second step. */
  onSelect: (categoryId: string) => void;
  /** Opens the second step, the subcategories of this principal. */
  onOpenSubcategories: (principalId: string) => void;
  /** Error text in Spanish, under the grid. */
  error?: string;
  /** The group, which the form focuses by script when the category is missing. */
  ref?: Ref<HTMLDivElement>;
};

/**
 * The categories of a phone (docs/diseno.md D19 › Cuadrícula de categorías): four columns of the
 * principals, each a button with its icon in a 44 px tile and its name under it (13 px, up to two
 * lines). A group named "Categoría", not a radio group: with radios, moving along a row with the
 * arrow keys would open the second step of a principal without meaning to (WCAG 3.2.2), so a cell
 * does something only when pressed (click, Enter or Space) and says `aria-pressed`.
 *
 * - A principal with no subcategories is chosen by pressing it.
 * - A principal **with** subcategories is chosen too, and opens the second step in the same sheet
 *   (`onOpenSubcategories`) to refine it; if one of its subcategories is already chosen, that choice
 *   is kept and the step opens on it.
 * - Under the grid, for a principal with subcategories, the choice written out ("Transporte › Taxi y
 *   apps", or "Solo Transporte") with "Cambiar", which opens the second step again.
 *
 * The chosen principal (or the one the chosen subcategory belongs to) is the pressed cell.
 */
export function CategoryGrid({
  tree,
  value,
  onSelect,
  onOpenSubcategories,
  error,
  ref,
}: CategoryGridProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const errorId = error ? `${id}-error` : undefined;
  const place = value ? findCategoryPlace(tree, value) : null;
  const chosenBranch = place
    ? tree.find((branch) => branch.principal.id === place.principal.id)
    : null;
  const choice =
    chosenBranch && chosenBranch.subs.length > 0 ? describeCategoryChoice(tree, value) : null;

  function press(branch: CategoryBranch) {
    if (branch.subs.length > 0) {
      // Keep a subcategory of this principal if one is chosen; otherwise the principal itself.
      if (place?.principal.id !== branch.principal.id) onSelect(branch.principal.id);
      onOpenSubcategories(branch.principal.id);
      return;
    }
    onSelect(branch.principal.id);
  }

  return (
    <div
      ref={ref}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={errorId}
      tabIndex={-1}
      data-invalid={error ? true : undefined}
      className="flex min-w-0 flex-col gap-2 data-[invalid=true]:text-destructive"
    >
      <span id={labelId} className="text-sm font-bold text-foreground">
        Categoría
      </span>
      <div className="grid grid-cols-4 gap-1.5">
        {tree.map((branch) => {
          const selected = place?.principal.id === branch.principal.id;
          return (
            <button
              key={branch.principal.id}
              type="button"
              aria-pressed={selected}
              title={branch.principal.name}
              onClick={() => press(branch)}
              className={cn(
                "flex min-w-0 cursor-pointer flex-col items-center gap-1 rounded-field px-0.5 py-1.5 text-foreground select-none",
                "transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none",
                selected ? "bg-primary/8 dark:bg-primary/12" : "hover:bg-foreground/5",
                focusRing,
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-icon",
                  selected ? "bg-primary text-primary-foreground" : "bg-card-solid text-primary",
                )}
              >
                <CategoryIcon icon={branch.principal.icon} className="size-5.5" />
              </span>
              <span
                className={cn(
                  "line-clamp-2 max-w-full text-center text-caption leading-tight wrap-anywhere",
                  selected ? "font-bold" : "font-semibold",
                )}
              >
                {branch.principal.name}
              </span>
            </button>
          );
        })}
      </div>
      {choice ? (
        <div className="flex min-h-11 items-center justify-between gap-2 rounded-field bg-primary/8 pr-1.5 pl-3.5 dark:bg-primary/12">
          <span className="min-w-0 truncate text-sm font-bold text-foreground" title={choice}>
            {choice}
          </span>
          <button
            type="button"
            onClick={() => place && onOpenSubcategories(place.principal.id)}
            className={cn(
              "min-h-11 shrink-0 cursor-pointer rounded-full px-3 text-sm font-bold text-primary select-none",
              focusRing,
            )}
          >
            Cambiar
          </button>
        </div>
      ) : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}

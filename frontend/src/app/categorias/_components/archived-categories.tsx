"use client";

import { CaretDown } from "@phosphor-icons/react/ssr";
import { useId, useMemo, useState } from "react";
import { CategoryIcon } from "@/components/category-icon";
import { useUnarchiveCategory } from "@/components/categories/use-unarchive-category";
import { Button } from "@/components/ui/button";
import { focusRing } from "@/components/ui/focus";
import {
  buildArchivedList,
  countUnarchivable,
  describeArchivedCategory,
} from "@/lib/core/categories";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { CategoryKind, CategoryRead } from "@/lib/core/data/categories";
import { NETWORK_ERROR } from "@/lib/core/i18n";
import { cn } from "@/lib/utils";

type ArchivedCategoriesProps = {
  /** Every category of the space, archived ones included. */
  categories: readonly CategoryRead[];
  /** The kind the segmented control shows: a phone lists only the archived ones of this kind. */
  visibleKind: CategoryKind;
  space: { id: string; timezone: string };
  api?: ApiClient;
};

/**
 * "Archivadas (n)" (docs/diseno.md D19): a folded section at the end of Categorías. Opened, each
 * archived category in `muted-foreground` with its line and "Desarchivar" (a button for each one
 * that can come back). The rules are in `buildArchivedList` and `describeArchivedCategory`: a
 * subcategory archived together with its principal sits under it with no button ("Se desarchiva
 * junto con X"); one archived before on its own, also under it, says "Desarchiva primero X"
 * (unarchiving it alone is a 409); one whose principal is active has its button.
 *
 * - **One markup for both widths.** The list holds every kind. A phone shows the kind of the
 *   segmented control: the items of the other kind are `display: none` below 1024 px, the number of
 *   the title has a phone version (`lg:hidden`) and a desktop one, and the section is hidden on a
 *   phone if it has nothing of that kind. From 1024 px it shows everything, and the line of each row
 *   goes with its kind in front ("Gasto · principal · archivada el 18 de octubre"). The number
 *   counts only the rows with a "Desarchivar".
 * - Unarchiving needs no confirmation (`useUnarchiveCategory`): the toast says it, without
 *   "Deshacer", and the row leaves. One at a time: the other buttons wait.
 */
export function ArchivedCategories({
  categories,
  visibleKind,
  space,
  api,
}: ArchivedCategoriesProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const unarchive = useUnarchiveCategory({ spaceId: space.id, api });
  const items = useMemo(() => buildArchivedList(categories), [categories]);
  if (items.length === 0) return null;

  const phoneHasItems = items.some((item) => item.category.kind === visibleKind);
  const phoneCount = countUnarchivable(items.filter((item) => item.category.kind === visibleKind));

  return (
    <section
      aria-label="Categorías archivadas"
      className={cn(
        "tile-surface flex min-w-0 flex-col rounded-tile lg:rounded-card lg:border-dashed lg:border-input lg:bg-transparent",
        !phoneHasItems && "max-lg:hidden",
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex min-h-13 items-center justify-between gap-3 rounded-[inherit] px-4 text-left text-item font-bold lg:min-h-11.5 lg:text-sm lg:text-muted-foreground",
          focusRing,
        )}
      >
        <span>
          Archivadas (<span className="lg:hidden">{phoneCount}</span>
          <span className="max-lg:hidden">{countUnarchivable(items)}</span>)
        </span>
        <CaretDown
          aria-hidden
          weight="bold"
          className={cn(
            "size-4 shrink-0 transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
      <ul id={panelId} hidden={!open} className="flex flex-col">
        {items.map((item) => {
          const { category } = item;
          const options = { timeZone: space.timezone };
          const phoneLine = describeArchivedCategory(item, options);
          const desktopLine = describeArchivedCategory(item, { ...options, showKind: true });
          return (
            <li
              key={category.id}
              className={cn(
                "flex min-h-16 items-center gap-3 border-t border-border py-2 pr-3 lg:min-h-13.5",
                item.nested ? "pl-11 lg:pl-15.5" : "pl-4 lg:pl-4.5",
                category.kind !== visibleKind && "max-lg:hidden",
              )}
            >
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-icon bg-muted text-muted-foreground lg:size-8"
              >
                <CategoryIcon icon={category.icon} className="size-4.5" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-muted-foreground">
                <span
                  title={category.name}
                  className="line-clamp-2 text-item font-bold wrap-anywhere"
                >
                  {category.name}
                </span>
                {/* The same text at both widths (a nested row) is written once. */}
                {phoneLine === desktopLine ? (
                  <span className="text-caption wrap-anywhere">{phoneLine}</span>
                ) : (
                  <>
                    <span className="text-caption wrap-anywhere lg:hidden">{phoneLine}</span>
                    <span className="text-caption wrap-anywhere max-lg:hidden">{desktopLine}</span>
                  </>
                )}
              </span>
              {item.canUnarchive ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="lg:min-h-9.5 lg:px-3.5 lg:pointer-coarse:min-h-11"
                  loading={unarchive.busyId === category.id}
                  disabled={unarchive.busyId !== undefined}
                  aria-label={`Desarchivar ${category.name}`}
                  onClick={() => unarchive.unarchive(category)}
                >
                  Desarchivar
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {unarchive.paused ? (
        <p role="status" className="px-4 pb-3 text-caption text-muted-foreground">
          {NETWORK_ERROR.title}. {NETWORK_ERROR.message}
        </p>
      ) : null}
    </section>
  );
}

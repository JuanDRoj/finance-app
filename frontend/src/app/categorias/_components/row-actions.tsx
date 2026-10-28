"use client";

import { Archive, PencilSimple, Plus } from "@phosphor-icons/react/ssr";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { CATEGORY_PANEL, categoryEditPanel } from "@/components/accounts/panel-url";
import { editCategoryPageHref, newCategoryPageHref } from "@/components/categories/category-urls";
import { useArchiveCategory } from "@/components/categories/use-archive-category";
import { PrimaryActionLink } from "@/components/primary-action-link";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { CategoryRead } from "@/lib/core/data/categories";
import { NETWORK_ERROR } from "@/lib/core/i18n";
import { cn } from "@/lib/utils";

// 36 px with a mouse (docs/diseno.md D17: a secondary control of desktop), 44 px with a finger. They
// are `muted-foreground` at full strength (the canvas draws them at 55 %, which would not reach the
// 3:1 of a control's icon).
const ACTION = cn(
  buttonVariants({ variant: "ghost", size: "icon" }),
  "text-muted-foreground lg:size-9 lg:pointer-coarse:size-11",
);

type RowActionsProps = {
  category: CategoryRead;
  /** A principal can take a subcategory ("Agregar subcategoría a {principal}"); a subcategory cannot. */
  isPrincipal: boolean;
  spaceId: string;
  /** The `id` of the title of the card the row is in: the focus goes there when the row archives itself. */
  headingId: string;
  api?: ApiClient;
};

/**
 * The actions of a row on desktop (docs/diseno.md D17, D19), at the right of it and hidden below
 * 1024 px, where a row is a link and the rest is in its form: "Agregar subcategoría a {principal}"
 * (only on a principal; the panel opens with it chosen), "Editar {nombre}" (the panel) and "Archivar
 * {nombre}". The first two are real links to the pages of the forms that open the panel on a plain
 * click (`PrimaryActionLink`), so Ctrl-click and no JavaScript still work.
 *
 * Archiving has no confirmation (`useArchiveCategory`: the toast "Archivaste «…»" with "Deshacer").
 * The row leaves the list, and the button it was pressed on with it, so the focus goes to the title
 * of the card instead of ending on the page. A failure is a toast in Spanish. Each row has its own
 * hook: its guard of "one at a time" is released only on failure, which is right for a row that
 * disappears on success, and wrong for one hook shared by all the rows.
 */
export function RowActions({ category, isPrincipal, spaceId, headingId, api }: RowActionsProps) {
  const router = useRouter();
  const archive = useArchiveCategory({
    spaceId,
    onArchived: () => {
      router.refresh();
      document.getElementById(headingId)?.focus();
    },
    api,
  });
  const { error } = archive;

  useEffect(() => {
    if (error) toast.error(error.title, { description: error.message });
  }, [error]);

  return (
    <div className="hidden shrink-0 items-center gap-0.5 pr-1.5 lg:flex">
      {isPrincipal ? (
        <PrimaryActionLink
          href={newCategoryPageHref({ parentId: category.id })}
          panel={{ ...CATEGORY_PANEL, extra: { padre: category.id } }}
          aria-label={`Agregar subcategoría a ${category.name}`}
          className={ACTION}
        >
          <Plus aria-hidden />
        </PrimaryActionLink>
      ) : null}
      <PrimaryActionLink
        href={editCategoryPageHref(category.id)}
        panel={categoryEditPanel(category.id)}
        aria-label={`Editar ${category.name}`}
        className={ACTION}
      >
        <PencilSimple aria-hidden />
      </PrimaryActionLink>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Archivar ${category.name}`}
        loading={archive.busy}
        className="text-muted-foreground lg:size-9 lg:pointer-coarse:size-11"
        onClick={() => archive.archive(category)}
      >
        {archive.busy ? null : <Archive aria-hidden />}
      </Button>
      {archive.paused ? (
        <span role="status" className="sr-only">
          {NETWORK_ERROR.title}. {NETWORK_ERROR.message}
        </span>
      ) : null}
    </div>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { CategoryForm, type CategoryFormDefaults } from "@/components/categories/category-form";
import { CategoryEditForm } from "@/components/categories/category-edit-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { browserApi } from "@/lib/api/browser";
import type { ApiClient } from "@/lib/core/data/api-client";
import { categoriesQueryOptions } from "@/lib/core/data/categories";
import { describeApiError } from "@/lib/core/i18n";

type CategoryPanelSheetProps = {
  /** Whether the panel is showing. It stays mounted while it leaves, so the exit animation plays. */
  open: boolean;
  /** "Nueva categoría" or "Editar categoría". */
  mode: "new" | "edit";
  space: { id: string };
  /** The category to edit (`mode: "edit"`). One that is not there, or is archived, closes the panel. */
  categoryId?: string;
  /** Where the new category starts (`mode: "new"`): its kind and its principal. */
  defaults?: CategoryFormDefaults;
  /** Called to close it: from "Cancelar", "Cerrar", Escape, the veil and a saved or archived category. */
  onClose: () => void;
  /** The API client; the browser's by default (the catalog scripts one). */
  api?: ApiClient;
};

/** The first field of the form: where the focus starts. */
function startOnTheName(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-slot='sheet-content'] input[name='name']");
}

/**
 * Where the focus goes after a category was created, saved or archived: the title of the screen
 * (`h1`, which the shell makes focusable). The button that opened the panel is no place to go back
 * to: the row it was in may have changed or left the list.
 */
function titleOfTheScreen(): HTMLElement | null {
  return document.querySelector<HTMLElement>("h1");
}

function PanelSkeleton() {
  return (
    <SheetBody role="status" aria-busy="true" aria-label="Cargando las categorías">
      <Skeleton className="h-16 w-full rounded-field" />
      <Skeleton className="h-13 w-full rounded-field" />
      <Skeleton className="h-13 w-full rounded-field" />
      <Skeleton className="h-60 w-full rounded-card" />
    </SheetBody>
  );
}

/**
 * The side panel of a category (docs/diseno.md D17 › Escritorio v2, D19): "Nueva categoría" or
 * "Editar categoría" in the `Sheet` on the right, from 1024 px. It is a container: whoever mounts it
 * (the screen Categorías, KAN-77) says when it is open and what to do on close.
 *
 * - The categories come from the query of the space **with the archived ones** (the screen hydrated
 *   it), asked again if they are not there. While they load the body is a skeleton; if that fails, an
 *   `Alert` with "Reintentar" (the panel stays: nothing is lost).
 * - Edit: the category is looked up in that list by `categoryId`. One that is gone, or archived (from
 *   another device), closes the panel: its form would only fail.
 * - The focus starts on the name once the form is there. When the panel closes after saving,
 *   creating, unarchiving or archiving, the page's changed: the focus goes to the title of the
 *   screen, and the server data is refreshed *after* closing, so the refresh already renders the URL
 *   without the panel's param and cannot bring it back. Closing without saving (Cancelar, Cerrar,
 *   Escape, the veil) returns the focus to what opened it, as in any dialog.
 */
export function CategoryPanelSheet({
  open,
  mode,
  space,
  categoryId,
  defaults,
  onClose,
  api = browserApi,
}: CategoryPanelSheetProps) {
  const router = useRouter();
  const finished = useRef(false);
  const query = useQuery({
    ...categoriesQueryOptions(api, space.id, { includeArchived: true }),
    enabled: open,
  });
  const categories = query.data;
  const category =
    mode === "edit"
      ? categories?.find((item) => item.id === categoryId && item.archived_at === null)
      : undefined;
  const ready = categories !== undefined && (mode === "new" || category !== undefined);
  const missing = mode === "edit" && query.isSuccess && category === undefined;

  // Every opening starts as "not finished yet".
  useEffect(() => {
    if (open) finished.current = false;
  }, [open]);

  // A category that is gone (archived elsewhere, or a stale link): nothing to show.
  useEffect(() => {
    if (open && missing) onClose();
  }, [open, missing, onClose]);

  // The name, once the form is there (the list may still be loading when the panel opens).
  useEffect(() => {
    if (open && ready) startOnTheName()?.focus();
  }, [open, ready]);

  function finish() {
    finished.current = true;
    onClose();
    router.refresh();
  }

  let body;
  if (categories && mode === "new") {
    body = (
      <CategoryForm
        space={space}
        categories={categories}
        variant="panel"
        defaults={defaults}
        onDone={finish}
        onCancel={onClose}
        api={api}
      />
    );
  } else if (categories && category) {
    body = (
      <CategoryEditForm
        key={category.id}
        category={category}
        categories={categories}
        space={space}
        variant="panel"
        onDone={(saved) => (saved ? finish() : onClose())}
        onArchived={finish}
        onCancel={onClose}
        api={api}
      />
    );
  } else if (query.isError) {
    const { title, message } = describeApiError(query.error);
    body = (
      <SheetBody>
        <Alert
          title={title}
          action={
            <Button
              variant="secondary"
              size="sm"
              loading={query.isFetching}
              onClick={() => void query.refetch()}
            >
              Reintentar
            </Button>
          }
        >
          {message}
        </Alert>
      </SheetBody>
    );
  } else {
    body = <PanelSkeleton />;
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent side="right" finalFocus={() => (finished.current ? titleOfTheScreen() : true)}>
        <SheetHeader>
          <SheetTitle>{mode === "new" ? "Nueva categoría" : "Editar categoría"}</SheetTitle>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  );
}

"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CATEGORY_PANEL,
  CATEGORY_PANEL_COMPANIONS,
  closePanelInUrl,
} from "@/components/accounts/panel-url";
import { editCategoryPageHref, newCategoryPageHref } from "@/components/categories/category-urls";
import { DESKTOP_MEDIA_QUERY, useIsDesktop } from "@/components/use-is-desktop";
import { categoryKindFromParam } from "@/lib/core/categories";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { CategoryKind } from "@/lib/core/data/categories";

// The panel (the sheet, the forms, react-hook-form and zod) loads when it is asked for, not with
// the screen.
const CategoryPanelSheet = dynamic(() =>
  import("@/components/categories/category-panel-sheet").then(
    (module) => module.CategoryPanelSheet,
  ),
);

/** What the URL asked for, kept while the panel plays its exit animation. */
type Shown = { mode: "new" | "edit"; id: string | null; kind?: CategoryKind; parentId?: string };

/** Takes the panel's param and its companions (`id`, `padre`) out of the URL; `tipo` stays: it is the tab of the list. */
function closeCategoryPanel() {
  closePanelInUrl(CATEGORY_PANEL.param, ...CATEGORY_PANEL_COMPANIONS);
}

/**
 * Where the side panel of a category is shown (docs/diseno.md D17 › Escritorio v2, D19). The screen
 * Categorías mounts it (a category is only ever made or edited over that list, so `AppShell` does
 * not carry it, unlike the panels of "Nueva cuenta" and "Registrar movimiento"). The URL says what to
 * show and `useSearchParams` reads it:
 *
 * - `?categoria=nueva` (with `&tipo=gastos|ingresos` and `&padre=<id>`, the kind and the principal
 *   the form starts on): "Nueva categoría".
 * - `?categoria=editar&id=<id>`: "Editar categoría" of that one. Without `id` there is nothing to
 *   edit: the param is taken out.
 *
 * - From 1024 px the panel opens over the list. Closing it takes `categoria`, `id` and `padre` out.
 * - Below 1024 px there are no panels: a form is a page, `/categorias/nueva` or `/categorias/<id>`,
 *   and a URL with the param (a link shared from a desktop, a window narrowed) goes to that page.
 * - The panel mounts the first time it is asked for and stays mounted (closed) afterwards, so it can
 *   play its exit animation; its form starts afresh every time it opens, because the sheet unmounts
 *   its content when closed. Any other value of `?categoria` is ignored.
 */
export function CategoryPanelHost({
  space,
  api,
}: Readonly<{ space: { id: string }; api?: ApiClient }>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const desktop = useIsDesktop();
  const param = searchParams.get(CATEGORY_PANEL.param);
  const id = searchParams.get("id");
  const mode = param === "nueva" ? "new" : param === "editar" ? "edit" : null;
  const requested = mode === "new" || (mode === "edit" && id !== null);
  const kind = categoryKindFromParam(searchParams.get("tipo"));
  const parentId = searchParams.get("padre") ?? undefined;
  const open = requested && desktop;

  // Derived during render, not in an effect: once the panel has been open it stays mounted, and it
  // remembers what it showed so it keeps its content while it fades out.
  const [shown, setShown] = useState<Shown | null>(null);
  if (
    open &&
    mode !== null &&
    (shown?.mode !== mode || shown.id !== id || shown.kind !== kind || shown.parentId !== parentId)
  ) {
    setShown({ mode, id, kind, parentId });
  }

  useEffect(() => {
    // The width is asked here, not taken from `desktop`: while hydrating the hook says "phone" and
    // would send a desktop to the page.
    if (mode === null) return;
    if (mode === "edit" && id === null) {
      closeCategoryPanel();
      return;
    }
    if (window.matchMedia(DESKTOP_MEDIA_QUERY).matches) return;
    router.replace(
      mode === "edit" && id !== null
        ? editCategoryPageHref(id)
        : newCategoryPageHref({ kind, parentId }),
    );
  }, [mode, id, kind, parentId, desktop, router]);

  if (!shown) return null;
  return (
    <CategoryPanelSheet
      open={open}
      mode={shown.mode}
      space={space}
      categoryId={shown.id ?? undefined}
      defaults={{ kind: shown.kind, parentId: shown.parentId }}
      onClose={closeCategoryPanel}
      api={api}
    />
  );
}

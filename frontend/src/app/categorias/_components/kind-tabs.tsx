"use client";

import { openPanelInUrl } from "@/components/accounts/panel-url";
import { SegmentedControl } from "@/components/segmented-control";
import { CATEGORY_KIND_PARAMS } from "@/lib/core/categories";
import type { CategoryKind } from "@/lib/core/data/categories";
import { CATEGORY_KIND_PLURAL_NAMES } from "@/lib/core/i18n";

const OPTIONS = (["expense", "income"] as const).map((kind) => ({
  value: CATEGORY_KIND_PARAMS[kind],
  label: CATEGORY_KIND_PLURAL_NAMES[kind],
}));

/**
 * Gastos · Ingresos, the segmented control of the phone (D19; K-H1-Categorias): only the kind chosen
 * is listed. It lives in the URL as `?tipo=gastos|ingresos` (`replaceState`, no request and no
 * history entries), so coming back from a form lands on the same tab, and "Nueva categoría" starts
 * with this kind. From 1024 px both kinds are on screen and it is hidden.
 */
export function KindTabs({ kind }: Readonly<{ kind: CategoryKind }>) {
  return (
    <SegmentedControl
      legend={<span className="sr-only">Tipo de categoría</span>}
      name="tipo"
      options={OPTIONS}
      value={CATEGORY_KIND_PARAMS[kind]}
      onChange={(event) => openPanelInUrl({ param: "tipo", value: event.target.value })}
      className="lg:hidden"
    />
  );
}

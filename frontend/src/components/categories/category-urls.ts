import { categoryKindParam } from "@/lib/core/categories";
import type { CategoryKind } from "@/lib/core/data/categories";

/**
 * The addresses of the forms of a category (docs/diseno.md D19), in one place because the pages, the
 * host of the panel and the links all need to agree. No `"use client"`: Server Components (the pages
 * of `/categorias/nueva` and `/categorias/[id]`) call these too.
 *
 * Below 1024 px a form is a page: `/categorias/nueva` (with `?tipo` and `?padre`) and
 * `/categorias/<id>`. From 1024 px it is the side panel over the list: `/categorias?categoria=nueva`
 * (the same `tipo` and `padre`) and `/categorias?categoria=editar&id=<id>`.
 */

export type NewCategoryStart = {
  /** The kind the form starts on (`?tipo=gastos|ingresos`). */
  kind?: CategoryKind;
  /** The principal it starts in (`?padre=<id>`, "Agregar subcategoría"). */
  parentId?: string;
};

function query(start: NewCategoryStart, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(extra);
  if (start.kind) params.set("tipo", categoryKindParam(start.kind));
  if (start.parentId) params.set("padre", start.parentId);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** The page of the form of a new category (below 1024 px). */
export function newCategoryPageHref(start: NewCategoryStart = {}): string {
  return `/categorias/nueva${query(start)}`;
}

/** The page of the form of an existing category (below 1024 px). */
export function editCategoryPageHref(categoryId: string): string {
  return `/categorias/${encodeURIComponent(categoryId)}`;
}

/** The list with the panel of a new category open (from 1024 px). */
export function newCategoryPanelHref(start: NewCategoryStart = {}): string {
  return `/categorias${query(start, { categoria: "nueva" })}`;
}

/** The list with the edit panel of a category open (from 1024 px). */
export function editCategoryPanelHref(categoryId: string): string {
  return `/categorias?${new URLSearchParams({ categoria: "editar", id: categoryId }).toString()}`;
}

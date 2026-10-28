"use client";

import { Plus } from "@phosphor-icons/react/ssr";
import { useSearchParams } from "next/navigation";
import { CATEGORY_PANEL } from "@/components/accounts/panel-url";
import { newCategoryPageHref } from "@/components/categories/category-urls";
import { PrimaryActionLink } from "@/components/primary-action-link";
import { focusRing } from "@/components/ui/focus";
import { categoryKindFromParam, categoryKindParam } from "@/lib/core/categories";
import { cn } from "@/lib/utils";

/**
 * "Nueva categoría" in the header (docs/diseno.md D17, D19): an icon of 44 px on a phone and a
 * `primary` pill with its text from 1024 px, the same element (the text is `sr-only` on a phone, so
 * the name is always "Nueva categoría"). It is a link to the page of the form, which from 1024 px
 * writes `?categoria=nueva` instead of navigating (as the sidebar button does for an account). It
 * starts the form on the kind the list is showing (`?tipo`, the tab of a phone; "gastos" if none),
 * which is why it is a Client Component: the page is a Server Component and does not know the tab.
 */
export function NewCategoryAction() {
  const kind = categoryKindFromParam(useSearchParams().get("tipo")) ?? "expense";
  return (
    <PrimaryActionLink
      href={newCategoryPageHref({ kind })}
      panel={{ ...CATEGORY_PANEL, extra: { tipo: categoryKindParam(kind) } }}
      className={cn(
        "inline-flex size-11 items-center justify-center gap-2 rounded-full border border-border bg-card-solid text-primary",
        "text-item font-bold transition-[transform,filter] duration-150 ease-out active:scale-[0.97] hover:brightness-95",
        "lg:h-11.5 lg:w-auto lg:border-0 lg:bg-primary lg:px-4.5 lg:text-primary-foreground",
        focusRing,
      )}
    >
      <Plus aria-hidden weight="bold" className="size-5 lg:size-4.5" />
      <span className="sr-only lg:not-sr-only">Nueva categoría</span>
    </PrimaryActionLink>
  );
}

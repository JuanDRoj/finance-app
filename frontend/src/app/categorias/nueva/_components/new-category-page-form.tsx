"use client";

import { CategoryForm, type CategoryFormDefaults } from "@/components/categories/category-form";
import type { CategoryRead } from "@/lib/core/data/categories";
import { useLeaveForm } from "../../_components/use-leave-form";

/**
 * The form of `/categorias/nueva` (below 1024 px): `CategoryForm` in its page variant, with the bar
 * fixed at the bottom, and back to where the person was once the category exists (or once the
 * archived one with the same name was unarchived): see `useLeaveForm`. The list of categories comes
 * from the server, archived ones included: "Dentro de" and the search of a repeated name use it.
 */
export function NewCategoryPageForm({
  space,
  categories,
  defaults,
}: Readonly<{
  space: { id: string };
  categories: readonly CategoryRead[];
  defaults: CategoryFormDefaults;
}>) {
  const leave = useLeaveForm();
  return (
    <CategoryForm
      variant="page"
      space={space}
      categories={categories}
      defaults={defaults}
      onDone={leave}
    />
  );
}

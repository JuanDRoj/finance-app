"use client";

import { CategoryEditForm } from "@/components/categories/category-edit-form";
import type { CategoryRead } from "@/lib/core/data/categories";
import { useLeaveForm } from "../../_components/use-leave-form";

/**
 * The form of `/categorias/[id]` (below 1024 px): `CategoryEditForm` in its page variant, and back
 * to the list after saving (also when there was nothing to save) or archiving (the toast with
 * "Deshacer" outlives the page): see `useLeaveForm`.
 */
export function EditCategoryPage({
  category,
  categories,
  space,
}: Readonly<{
  category: CategoryRead;
  categories: readonly CategoryRead[];
  space: { id: string };
}>) {
  const leave = useLeaveForm();
  return (
    <CategoryEditForm
      variant="page"
      category={category}
      categories={categories}
      space={space}
      onDone={() => leave()}
      onArchived={leave}
    />
  );
}

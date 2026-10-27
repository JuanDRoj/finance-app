"use client";

import type { ComponentProps } from "react";
import { SelectField } from "@/components/select-field";
import { groupCategoriesForSelect, type CategoryBranch } from "@/lib/core/categories";

type CategorySelectProps = Omit<ComponentProps<typeof SelectField>, "children" | "label"> & {
  /** The principals of the kind of the movement with their subcategories (`buildCategoryTree`). */
  tree: readonly CategoryBranch[];
};

/**
 * The category of the side panel of desktop (docs/diseno.md D17 › Escritorio v2, D19): a native
 * `<select>` grouped by principal, as the canvas draws it. A principal with subcategories is a
 * group with its own name, with the principal itself first (a movement may go to it) and then its
 * subcategories; the principals with none go together in a last group, "Otras". Nothing is chosen
 * at first ("Elige una"), so the person picks. A `SelectField`: label, error and `aria-invalid` are
 * wired, and it takes the props of the controller of a form (`value`, `onChange`, `onBlur`, `ref`).
 */
export function CategorySelect({ tree, placeholder = "Elige una", ...props }: CategorySelectProps) {
  return (
    <SelectField label="Categoría" placeholder={placeholder} {...props}>
      {groupCategoriesForSelect(tree).map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </optgroup>
      ))}
    </SelectField>
  );
}

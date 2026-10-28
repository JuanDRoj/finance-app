import { z } from "zod";
import type {
  CategoryCreate,
  CategoryIconKey,
  CategoryKind,
  CategoryRead,
  CategoryUpdate,
} from "../data/categories";
import { CATEGORY_ICON_NAMES } from "../i18n";

/**
 * Schemas of the forms of a category (docs/diseno.md D19, "Formulario de categoría"). The form holds
 * text (the name as typed, the chosen principal as an id or "" for none); the schema checks it and
 * **transforms it into the body of the request**: `POST /spaces/{space_id}/categories`
 * (`CategoryCreate`) when creating, and `PATCH .../{category_id}` (`CategoryUpdate`, only what
 * changed) when editing. Messages are the Spanish text shown under each field.
 */

/**
 * The backend caps a category name at 80 characters (Pydantic `max_length`, after trimming) and the
 * database at 80 (`ck_categories_name_length`, `char_length`): both count code points, so does the
 * form (zod's `.max()` counts UTF-16 units, where an emoji weighs 2).
 */
export const CATEGORY_NAME_MAX_LENGTH = 80;

const NAME_REQUIRED = "Escribe un nombre.";
const NAME_TOO_LONG = `Usa como máximo ${CATEGORY_NAME_MAX_LENGTH} caracteres.`;
const ICON_REQUIRED = "Elige un ícono.";

/** The icon picked when a category is created: the generic one (docs/diseno.md D19). */
export const DEFAULT_CATEGORY_ICON: CategoryIconKey = "tag";

/** The 66 icons of the list, in the backend's order: the keys of the map of their names. */
export const CATEGORY_ICON_KEYS = Object.keys(CATEGORY_ICON_NAMES) as [
  CategoryIconKey,
  ...CategoryIconKey[],
];

const nameSchema = z
  .string({ error: NAME_REQUIRED })
  .trim()
  .min(1, NAME_REQUIRED)
  .refine((name) => [...name].length <= CATEGORY_NAME_MAX_LENGTH, NAME_TOO_LONG);

/**
 * The form of "Nueva categoría". `parentId` is "" for a principal category and the id of a principal
 * for a subcategory ("Dentro de"); a subcategory has its principal's kind, which the form keeps in
 * step (it only offers principals of the chosen kind), so the body sends both and the backend
 * checks they agree (`category_kind_mismatch`).
 */
export const categoryFormSchema = z
  .object({
    kind: z.enum(["expense", "income"], { error: "Elige un tipo." }),
    name: nameSchema,
    parentId: z.string(),
    icon: z.enum(CATEGORY_ICON_KEYS, { error: ICON_REQUIRED }),
  })
  .transform((values): CategoryCreate => {
    const body: CategoryCreate = { name: values.name, kind: values.kind, icon: values.icon };
    if (values.parentId !== "") body.parent_id = values.parentId;
    return body;
  });

/** What the "Nueva categoría" form holds, before the schema checks it. */
export type CategoryFormValues = z.input<typeof categoryFormSchema>;

/** The values the form starts with; `kind` and `parentId` come from where it was opened. */
export function categoryFormDefaults(
  options: { kind?: CategoryKind; parentId?: string } = {},
): CategoryFormValues {
  return {
    kind: options.kind ?? "expense",
    name: "",
    parentId: options.parentId ?? "",
    icon: DEFAULT_CATEGORY_ICON,
  };
}

// Contract check (frontend/CLAUDE.md > Formularios): the form's values are not the request body, so
// what must match the generated type is the schema's **output**. What really holds it is the type
// `CategoryCreate` on `body` in the `.transform`; this line is a second net.
const _check: CategoryCreate = {} as z.output<typeof categoryFormSchema>;
void _check;

// The field of the form each field of the backend's body is shown on. Anything else a 422 names
// goes to the Alert: the person cannot fix it in a field.
const FIELD_OF_API_FIELD: Readonly<Record<string, keyof CategoryFormValues>> = {
  name: "name",
  kind: "kind",
  icon: "icon",
  parent_id: "parentId",
};

/** The field of the create form a 422 points at (`loc` without `body`), or `undefined` if it has none. */
export function categoryFormFieldOf(path: string): keyof CategoryFormValues | undefined {
  return Object.hasOwn(FIELD_OF_API_FIELD, path) ? FIELD_OF_API_FIELD[path] : undefined;
}

/**
 * What the edit form holds: the name and the icon (a plain string: it is the category's own key,
 * which may be one this frontend does not know yet). The kind and the principal cannot change.
 */
export type CategoryEditValues = { name: string; icon: string };

/** The part of a category the edit schema needs. */
type EditableCategory = Pick<CategoryRead, "name" | "icon">;

const isKnownIcon = (icon: string) => Object.hasOwn(CATEGORY_ICON_NAMES, icon);

/**
 * The schema of "Editar categoría": the name and the icon. It becomes the body of `PATCH` with
 * **only what changed**; an empty body (`{}`) means "nothing to save", and the form closes without a
 * request. A name that differs only in case is a change (the backend allows it: it is the same row).
 * The icon must be on the list, except the category's own: if the backend added an icon this
 * frontend does not know and a category has it, editing its name must still work (the icon is not
 * sent when it did not change).
 */
export function categoryEditSchema(category: EditableCategory) {
  return z
    .object({
      name: nameSchema,
      icon: z
        .string({ error: ICON_REQUIRED })
        .refine((icon) => icon === category.icon || isKnownIcon(icon), ICON_REQUIRED),
    })
    .transform((values): CategoryUpdate => {
      const body: CategoryUpdate = {};
      if (values.name !== category.name) body.name = values.name;
      // Known (or unchanged, and then not sent): the refinement above vouches for the key.
      if (values.icon !== category.icon) body.icon = values.icon as CategoryIconKey;
      return body;
    });
}

/** The values the edit form starts with: the category's own. */
export function categoryEditValuesOf(category: EditableCategory): CategoryEditValues {
  return { name: category.name, icon: category.icon };
}

/** The field of the edit form a 422 points at, or `undefined` (the kind and the principal cannot be edited). */
export function categoryEditFieldOf(path: string): keyof CategoryEditValues | undefined {
  return path === "name" || path === "icon" ? path : undefined;
}

// Second net, as for the create schema.
const _checkEdit: CategoryUpdate = {} as z.output<ReturnType<typeof categoryEditSchema>>;
void _checkEdit;

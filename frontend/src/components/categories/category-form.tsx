"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, type SyntheticEvent } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { IconPicker } from "@/components/categories/icon-picker";
import { PageFooter } from "@/components/categories/page-footer";
import { SegmentedControl } from "@/components/segmented-control";
import { SelectField } from "@/components/select-field";
import { TextField } from "@/components/text-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SheetBody, SheetFooter } from "@/components/ui/sheet";
import { browserApi } from "@/lib/api/browser";
import { buildCategoryTree, findCategory, findNameClash } from "@/lib/core/categories";
import type { ApiClient } from "@/lib/core/data/api-client";
import { apiErrorCode } from "@/lib/core/data/accounts";
import {
  categoriesRootKey,
  createCategory,
  unarchiveCategory,
  type CategoryCreate,
  type CategoryKind,
  type CategoryRead,
} from "@/lib/core/data/categories";
import { isUnauthorized } from "@/lib/core/data/errors";
import {
  CATEGORY_KIND_NAMES,
  NETWORK_ERROR,
  describeApiError,
  validationIssuesOf,
  type ErrorDescription,
} from "@/lib/core/i18n";
import { truncateLabel } from "@/lib/core/movement-label";
import {
  categoryFormDefaults,
  categoryFormFieldOf,
  categoryFormSchema,
  type CategoryFormValues,
} from "@/lib/core/schemas/category";

const KIND_OPTIONS = (Object.keys(CATEGORY_KIND_NAMES) as CategoryKind[]).map((value) => ({
  value,
  label: CATEGORY_KIND_NAMES[value],
}));

const NAME_TAKEN = "Ya tienes una categoría con ese nombre.";
const NAME_TAKEN_ARCHIVED =
  "Ya tienes una categoría archivada con ese nombre. Puedes desarchivarla y seguir usándola.";

export type CategoryFormDefaults = {
  /** The kind the form starts with (the one the list was showing). */
  kind?: CategoryKind;
  /**
   * An active principal category to create the subcategory in ("Agregar subcategoría"): "Dentro de"
   * starts on it and the kind is its own. An id that is not an active principal of the list is
   * ignored (a stale link): the form then starts as a principal category.
   */
  parentId?: string;
};

type CategoryFormProps = {
  space: { id: string };
  /**
   * Every category of the space, **archived ones included** (`includeArchived: true`, what Categorías
   * hydrates): the principals of "Dentro de" come from it, and so does the search of the sibling a
   * repeated name clashes with, which may be archived.
   */
  categories: readonly CategoryRead[];
  /**
   * `page`: the form of `/categorias/nueva`, below 1024 px, with "Crear categoría" in a bar fixed
   * at the bottom. `panel`: inside the side panel (`SheetContent`), with "Cancelar · Crear categoría"
   * in its footer and the fields in the part that scrolls.
   */
  variant: "page" | "panel";
  defaults?: CategoryFormDefaults;
  /**
   * Called once the category exists, or once the archived one with the same name was unarchived (the
   * toast is already shown): the container leaves the form and refreshes the server data
   * (`router.refresh()`), in the order that suits it.
   */
  onDone: (category: CategoryRead) => void;
  /** The "Cancelar" of the panel. */
  onCancel?: () => void;
  /** The API client; the browser's by default. The catalog passes a scripted one to show every state. */
  api?: ApiClient;
};

/** The values the form starts with, from where it was opened. */
function startingValues(
  categories: readonly CategoryRead[],
  defaults: CategoryFormDefaults = {},
): CategoryFormValues {
  const parent = defaults.parentId ? findCategory(categories, defaults.parentId) : undefined;
  if (parent && parent.parent_id === null && parent.archived_at === null) {
    return categoryFormDefaults({ kind: parent.kind, parentId: parent.id });
  }
  return categoryFormDefaults({ kind: defaults.kind });
}

/**
 * The form of a new category (docs/diseno.md D19, "Formulario de categoría"), one component in two
 * containers: a page below 1024 px and the side panel from 1024 px. Only creating; editing is
 * `CategoryEditForm`.
 *
 * - **Tipo** (Gasto · Ingreso), **Nombre**, **Dentro de** (a principal of the chosen kind, or none:
 *   "Ninguna: es una categoría principal") and **Ícono** (`tag` chosen). Changing the kind empties
 *   "Dentro de": a subcategory has its principal's kind.
 * - react-hook-form with `categoryFormSchema`, which turns the form into the body of `POST
 *   /spaces/{id}/categories`. A 422 marks the fields it names (`validationIssuesOf`); anything else
 *   goes to an `Alert` in Spanish. A 401 goes to `/login`.
 * - **Repeated name** (409 `category_name_taken`): the backend only sends the code, so the sibling it
 *   clashes with is looked for in `categories`. An **archived** one (the unique name counts the
 *   archived) gets "Ya tienes una categoría archivada con ese nombre. Puedes desarchivarla y seguir
 *   usándola." with the button "Desarchivar «…»", which unarchives it, says so and leaves the form;
 *   an active one, or none found, gets "Ya tienes una categoría con ese nombre." on the field.
 * - One request at a time, even for a double tap: a `ref` is set before each `mutate` (the busy state
 *   comes from the previous render and `handleSubmit` is asynchronous). Without a connection
 *   TanStack Query pauses the request and the form says so.
 * - On success: the categories of the space are invalidated (the sheet of "Registrar movimiento"
 *   offers the new one), a toast says "Creaste «…»" and `onDone` runs.
 */
export function CategoryForm({
  space,
  categories,
  variant,
  defaults,
  onDone,
  onCancel,
  api = browserApi,
}: CategoryFormProps) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<ErrorDescription | null>(null);
  // The archived category the repeated name clashes with, while its message is on the field.
  const [archivedClash, setArchivedClash] = useState<CategoryRead | null>(null);
  const sending = useRef(false);
  const [initial] = useState(() => startingValues(categories, defaults));

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    clearErrors,
    control,
    formState: { errors },
  } = useForm<CategoryFormValues, unknown, CategoryCreate>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: initial,
  });

  const kind = useWatch({ control, name: "kind" });
  const principals = useMemo(
    () => buildCategoryTree(categories, kind).map((branch) => branch.principal),
    [categories, kind],
  );
  const kindField = register("kind");
  const parentField = register("parentId");

  // The repeated-name notice is about one name in one place (kind and principal): when either
  // changes it no longer applies, and its "Desarchivar" would unarchive something unrelated.
  function dropNameNotice() {
    setArchivedClash(null);
    clearErrors("name");
  }

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: categoriesRootKey(space.id) });
  }

  const mutation = useMutation({
    mutationFn: (body: CategoryCreate) => createCategory(api, space.id, body),
    onSuccess: (created) => {
      invalidate();
      toast.success(`Creaste «${truncateLabel(created.name)}»`);
      onDone(created);
    },
    onError: (error, body) => {
      sending.current = false;
      // An expired session is not a form problem: the API client's 401 rule is for queries only.
      if (isUnauthorized(error)) {
        window.location.replace("/login");
        return;
      }
      if (apiErrorCode(error) === "category_name_taken") {
        const clash = findNameClash(categories, {
          name: body.name,
          kind: body.kind,
          parentId: body.parent_id ?? null,
        });
        if (clash && clash.archived_at !== null) {
          setArchivedClash(clash);
          setError("name", { type: "server", message: NAME_TAKEN_ARCHIVED }, { shouldFocus: true });
        } else {
          setError("name", { type: "server", message: NAME_TAKEN }, { shouldFocus: true });
        }
        return;
      }
      const issues = validationIssuesOf(error);
      let focused = false;
      let unplaced = issues.length === 0;
      for (const issue of issues) {
        const field = categoryFormFieldOf(issue.path);
        if (!field) {
          unplaced = true;
          continue;
        }
        setError(field, { type: "server", message: issue.message }, { shouldFocus: !focused });
        focused = true;
      }
      // The principal was archived or deleted since the list was read: ask for it again, so "Dentro
      // de" stops offering it.
      if (issues.some((issue) => issue.path === "parent_id")) invalidate();
      if (unplaced) setFormError(describeApiError(error));
    },
  });

  const unarchive = useMutation({
    mutationFn: (category: CategoryRead) => unarchiveCategory(api, space.id, category.id),
    onSuccess: (category) => {
      invalidate();
      toast.success(`Desarchivaste «${truncateLabel(category.name)}»`);
      onDone(category);
    },
    onError: (error) => {
      if (isUnauthorized(error)) {
        window.location.replace("/login");
        return;
      }
      setFormError(describeApiError(error));
    },
  });

  // Without a connection TanStack Query does not fail: it pauses the request and sends it when the
  // network is back, so the button would stay busy for good with no word of why. Say it.
  const offline = mutation.isPaused || unarchive.isPaused;

  // Busy while it runs and once it worked: the container is leaving, a second tap must not create a
  // second category.
  const busy =
    mutation.isPending || mutation.isSuccess || unarchive.isPending || unarchive.isSuccess;

  function send(body: CategoryCreate) {
    if (busy || sending.current) return;
    sending.current = true;
    setFormError(null);
    setArchivedClash(null);
    mutation.mutate(body);
  }

  // Called from the event, not during the render: `send` reads the `sending` ref.
  function submit(event: SyntheticEvent<HTMLFormElement>) {
    return handleSubmit(send)(event);
  }

  const nameError = errors.name?.message;
  const fields = (
    <>
      <SegmentedControl
        legend="Tipo"
        options={KIND_OPTIONS}
        defaultValue={initial.kind}
        error={errors.kind?.message}
        {...kindField}
        onChange={(event) => {
          void kindField.onChange(event);
          // A subcategory has its principal's kind: the principal of the other kind no longer applies.
          setValue("parentId", "");
          dropNameNotice();
        }}
      />
      <div className="flex flex-col gap-2">
        <TextField
          label="Nombre"
          placeholder="Ej.: Gimnasio"
          autoComplete="off"
          autoCapitalize="sentences"
          enterKeyHint="done"
          error={nameError}
          {...register("name")}
        />
        {archivedClash && errors.name?.type === "server" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start wrap-anywhere"
            loading={unarchive.isPending}
            disabled={busy && !unarchive.isPending}
            onClick={() => {
              setFormError(null);
              unarchive.mutate(archivedClash);
            }}
          >
            {`Desarchivar «${truncateLabel(archivedClash.name)}»`}
          </Button>
        ) : null}
      </div>
      <SelectField
        label="Dentro de"
        placeholder="Ninguna: es una categoría principal"
        description="Elige una principal para crearla como subcategoría."
        error={errors.parentId?.message}
        {...parentField}
        onChange={(event) => {
          void parentField.onChange(event);
          dropNameNotice();
        }}
      >
        {principals.map((principal) => (
          <option key={principal.id} value={principal.id}>
            {principal.name}
          </option>
        ))}
      </SelectField>
      <IconPicker
        size={variant === "panel" ? "panel" : "page"}
        defaultValue={initial.icon}
        error={errors.icon?.message}
        {...register("icon")}
      />
      {offline ? <Alert title={NETWORK_ERROR.title}>{NETWORK_ERROR.message}</Alert> : null}
      {formError && !offline ? <Alert title={formError.title}>{formError.message}</Alert> : null}
    </>
  );

  if (variant === "panel") {
    return (
      <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <SheetBody>{fields}</SheetBody>
        <SheetFooter>
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" size="sm" loading={busy}>
            Crear categoría
          </Button>
        </SheetFooter>
      </form>
    );
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4.5 pb-28">
      {fields}
      <PageFooter>
        <Button type="submit" loading={busy}>
          Crear categoría
        </Button>
      </PageFooter>
    </form>
  );
}

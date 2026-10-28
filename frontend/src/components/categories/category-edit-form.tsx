"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Archive } from "@phosphor-icons/react/ssr";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { IconPicker } from "@/components/categories/icon-picker";
import { PageFooter } from "@/components/categories/page-footer";
import { useArchiveCategory } from "@/components/categories/use-archive-category";
import { TextField } from "@/components/text-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { focusRing } from "@/components/ui/focus";
import { SheetBody, SheetFooter } from "@/components/ui/sheet";
import { browserApi } from "@/lib/api/browser";
import { describeArchiveHelp, describeCategoryPlace, findNameClash } from "@/lib/core/categories";
import { apiErrorCode } from "@/lib/core/data/accounts";
import type { ApiClient } from "@/lib/core/data/api-client";
import {
  categoriesRootKey,
  updateCategory,
  type CategoryRead,
  type CategoryUpdate,
} from "@/lib/core/data/categories";
import { isUnauthorized } from "@/lib/core/data/errors";
import { transactionsQueryKey } from "@/lib/core/data/transactions";
import {
  NETWORK_ERROR,
  describeApiError,
  validationIssuesOf,
  type ErrorDescription,
} from "@/lib/core/i18n";
import { truncateLabel } from "@/lib/core/movement-label";
import {
  categoryEditFieldOf,
  categoryEditSchema,
  categoryEditValuesOf,
  type CategoryEditValues,
} from "@/lib/core/schemas/category";
import { cn } from "@/lib/utils";

const NAME_TAKEN = "Ya tienes una categoría con ese nombre.";
const NAME_TAKEN_ARCHIVED = "Ya tienes una categoría archivada con ese nombre.";

type CategoryEditFormProps = {
  category: CategoryRead;
  /**
   * Every category of the space, archived ones included (what Categorías hydrates): the note at the
   * top names the principal of a subcategory, the help of "Archivar categoría" counts the active
   * subcategories, and a repeated name looks for the sibling it clashes with.
   */
  categories: readonly CategoryRead[];
  space: { id: string };
  /**
   * `page`: `/categorias/[id]` below 1024 px, with "Guardar cambios" in a bar fixed at the bottom
   * and the "Más acciones" group under the form. `panel`: inside the side panel, the fields and the
   * group scroll, "Cancelar · Guardar cambios" below.
   */
  variant: "page" | "panel";
  /** The changes are saved (or there was nothing to save: `saved` is false); the toast is shown. */
  onDone: (saved: boolean) => void;
  /** The category was archived (the toast with "Deshacer" is shown). */
  onArchived: () => void;
  onCancel?: () => void;
  api?: ApiClient;
};

/** The row of "Más acciones": icon, title, a line under it. */
function ActionRow({
  icon,
  title,
  help,
  busy,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  help: string;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy || undefined}
      className={cn(
        "flex min-h-15 w-full items-center gap-3 px-4 py-2 text-left disabled:opacity-60 lg:min-h-14",
        "rounded-[inherit]",
        focusRing,
      )}
    >
      <span aria-hidden className="shrink-0 text-primary [&_svg]:size-5.5">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-item font-bold break-words">{title}</span>
        <span className="text-caption break-words text-muted-foreground">{help}</span>
      </span>
    </button>
  );
}

/**
 * The form of an existing category (docs/diseno.md D19, "Formulario de categoría" > Editar): a note
 * with where it sits ("Categoría de gasto · principal", or "Subcategoría de {principal}") and that
 * "El tipo y la categoría principal no se cambian después de crearla.", the **Nombre**, the **Ícono**
 * and the group **Más acciones** with "Archivar categoría" and its help.
 *
 * - react-hook-form with `categoryEditSchema(category)`, which turns the form into the body of
 *   `PATCH .../{id}` with **only what changed**. Nothing changed: no request, `onDone(false)`.
 * - A 422 marks the fields it names; anything else goes to an `Alert` in Spanish. Without a
 *   connection TanStack Query pauses the request and the form says so.
 * - **Repeated name** (409 `category_name_taken`): on the name field, "Ya tienes una categoría con ese
 *   nombre." or, if the sibling it clashes with is archived, "Ya tienes una categoría archivada con
 *   ese nombre." There is **no** "Desarchivar" here (unlike when creating): unarchiving would not
 *   free the name, and leaving to do it would drop the rename.
 * - On success: the categories of the space are invalidated, and so are the movements (their rows
 *   show the name and the icon), a toast says "Guardaste «…»" and `onDone(true)` runs.
 * - "Archivar categoría" runs `useArchiveCategory`: archived with "Deshacer", and `onArchived`.
 */
export function CategoryEditForm({
  category,
  categories,
  space,
  variant,
  onDone,
  onArchived,
  onCancel,
  api = browserApi,
}: CategoryEditFormProps) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<ErrorDescription | null>(null);
  const sending = useRef(false);
  const actionsId = useId();

  const schema = useMemo(
    () => categoryEditSchema(category),
    // The schema only reads these two fields of the category.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [category.name, category.icon],
  );
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<CategoryEditValues, unknown, CategoryUpdate>({
    resolver: zodResolver(schema),
    defaultValues: categoryEditValuesOf(category),
  });

  const archive = useArchiveCategory({ spaceId: space.id, onArchived, api });

  const mutation = useMutation({
    mutationFn: (body: CategoryUpdate) => updateCategory(api, space.id, category.id, body),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: categoriesRootKey(space.id) });
      // The rows of the movements show the name and the icon of their category.
      void queryClient.invalidateQueries({ queryKey: transactionsQueryKey(space.id) });
      toast.success(`Guardaste «${truncateLabel(saved.name)}»`);
      onDone(true);
    },
    onError: (error, body) => {
      sending.current = false;
      if (isUnauthorized(error)) {
        window.location.replace("/login");
        return;
      }
      if (apiErrorCode(error) === "category_name_taken") {
        const clash = findNameClash(categories, {
          name: body.name ?? category.name,
          kind: category.kind,
          parentId: category.parent_id,
          excludeId: category.id,
        });
        const message = clash && clash.archived_at !== null ? NAME_TAKEN_ARCHIVED : NAME_TAKEN;
        setError("name", { type: "server", message }, { shouldFocus: true });
        return;
      }
      const issues = validationIssuesOf(error);
      let focused = false;
      let unplaced = issues.length === 0;
      for (const issue of issues) {
        const field = categoryEditFieldOf(issue.path);
        if (!field) {
          unplaced = true;
          continue;
        }
        setError(field, { type: "server", message: issue.message }, { shouldFocus: !focused });
        focused = true;
      }
      if (unplaced) setFormError(describeApiError(error));
    },
  });

  const offline = mutation.isPaused || archive.paused;
  const busy = mutation.isPending || mutation.isSuccess;
  const anyBusy = busy || archive.busy;

  function send(body: CategoryUpdate) {
    if (anyBusy || sending.current) return;
    setFormError(null);
    if (Object.keys(body).length === 0) {
      onDone(false);
      return;
    }
    sending.current = true;
    mutation.mutate(body);
  }

  // Called from the event, not during the render: `send` reads the `sending` ref.
  function submit(event: SyntheticEvent<HTMLFormElement>) {
    return handleSubmit(send)(event);
  }

  const shownError = formError ?? archive.error;
  const fields = (
    <>
      <div className="flex flex-col gap-1 rounded-field bg-primary-soft px-4 py-3.5">
        <span className="text-item font-bold break-words">
          {describeCategoryPlace(category, categories)}
        </span>
        <span className="text-caption text-muted-foreground">
          El tipo y la categoría principal no se cambian después de crearla.
        </span>
      </div>
      <TextField
        label="Nombre"
        autoComplete="off"
        autoCapitalize="sentences"
        enterKeyHint="done"
        error={errors.name?.message}
        {...register("name")}
      />
      <IconPicker
        size={variant === "panel" ? "panel" : "page"}
        error={errors.icon?.message}
        defaultValue={category.icon}
        {...register("icon")}
      />
      {offline ? <Alert title={NETWORK_ERROR.title}>{NETWORK_ERROR.message}</Alert> : null}
      {shownError && !offline ? <Alert title={shownError.title}>{shownError.message}</Alert> : null}
    </>
  );

  const moreActions = (
    <section aria-labelledby={actionsId} className="flex min-w-0 flex-col gap-2">
      <h2 id={actionsId} className="text-sm font-bold text-muted-foreground">
        Más acciones
      </h2>
      <div className="tile-surface flex flex-col rounded-tile lg:rounded-field">
        <ActionRow
          icon={<Archive />}
          title="Archivar categoría"
          help={describeArchiveHelp(category, categories)}
          busy={archive.busy}
          disabled={anyBusy}
          onClick={() => archive.archive(category)}
        />
      </div>
    </section>
  );

  if (variant === "panel") {
    return (
      <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <SheetBody>
          {fields}
          {moreActions}
        </SheetBody>
        <SheetFooter>
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" size="sm" loading={busy}>
            Guardar cambios
          </Button>
        </SheetFooter>
      </form>
    );
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4.5 pb-28">
      {fields}
      {moreActions}
      <PageFooter>
        <Button type="submit" loading={busy}>
          Guardar cambios
        </Button>
      </PageFooter>
    </form>
  );
}

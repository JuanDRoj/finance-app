"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, Scales } from "@phosphor-icons/react/ssr";
import { useId, useMemo, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ArchiveBlocked } from "@/components/accounts/archive-blocked";
import { CardDaysFields } from "@/components/accounts/card-days-fields";
import { useArchiveAccount } from "@/components/accounts/use-archive-account";
import { TextField } from "@/components/text-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { focusRing } from "@/components/ui/focus";
import { SheetBody, SheetFooter } from "@/components/ui/sheet";
import { browserApi } from "@/lib/api/browser";
import {
  updateAccount,
  type AccountUpdate,
  type AccountWithBalance,
} from "@/lib/core/data/accounts";
import type { ApiClient } from "@/lib/core/data/api-client";
import { isUnauthorized } from "@/lib/core/data/errors";
import { spaceQueryKey } from "@/lib/core/data/spaces";
import {
  NETWORK_ERROR,
  describeAccountType,
  describeApiError,
  validationIssuesOf,
  type ErrorDescription,
} from "@/lib/core/i18n";
import { formatMoney, type Currency } from "@/lib/core/money";
import {
  accountEditSchema,
  editValuesOf,
  type AccountEditValues,
} from "@/lib/core/schemas/account";
import { cn } from "@/lib/utils";

const RECONCILE_HELP = {
  bank: "Iguálalo con lo que dice tu banco",
  cash: "Iguálalo con el efectivo que tienes",
  credit_card: "Iguálala con el resumen de tu tarjeta",
} as const;

// The field of the form each field of the backend's body is shown on.
const FIELD_OF_API_FIELD: Readonly<Record<string, keyof AccountEditValues>> = {
  name: "name",
  closing_day: "closingDay",
  due_day: "dueDay",
};

type AccountEditFormProps = {
  account: AccountWithBalance;
  space: { id: string; currency: Currency };
  /**
   * `page`: `/cuentas/[id]` below 1024 px, "Guardar cambios" full width and the "Más acciones" group
   * under the form (K-H1-CuentaForm). `panel`: inside the side panel, the fields and the group scroll,
   * "Cancelar · Guardar cambios" below.
   */
  variant: "page" | "panel";
  /** The changes are saved (or there was nothing to save: `saved` is false); the toast is shown. */
  onDone: (saved: boolean) => void;
  /** The account was archived (the toast with "Deshacer" is shown). */
  onArchived: () => void;
  /** "Cuadrar saldo", from "Más acciones" or from the alert of archiving. */
  onReconcile: () => void;
  onCancel?: () => void;
  api?: ApiClient;
};

/** One row of "Más acciones": icon, title, a line under it. */
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
        "first:rounded-t-[inherit] last:rounded-b-[inherit] not-first:border-t not-first:border-border",
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
 * The form of an existing account (docs/diseno.md D18, "Editar cuenta"; K-H1-CuentaForm and
 * K-V2-EditarTarjeta): the type shown fixed with its note, the name, a card's two days (the
 * account's own, never "Elige"), and the group **Más acciones** with "Cuadrar saldo" and "Archivar
 * cuenta".
 *
 * - react-hook-form with `accountEditSchema(account)`, which turns the form into the body of
 *   `PATCH .../{id}` with **only what changed**. Nothing changed: no request, `onDone(false)`.
 * - A 422 marks the fields it names; anything else goes to an `Alert` in Spanish. Without a
 *   connection TanStack Query pauses the request and the form says so.
 * - "Archivar cuenta" runs `useArchiveAccount`: archived with "Deshacer", or the alert "No se puede
 *   archivar" on top of this form when the balance is not zero, whose "Cuadrar saldo" calls
 *   `onReconcile`.
 */
export function AccountEditForm({
  account,
  space,
  variant,
  onDone,
  onArchived,
  onReconcile,
  onCancel,
  api = browserApi,
}: AccountEditFormProps) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<ErrorDescription | null>(null);
  const actionsId = useId();
  const isCard = account.type === "credit_card";

  const schema = useMemo(
    () => accountEditSchema(account),
    // The schema only reads these four fields of the account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [account.type, account.name, account.closing_day, account.due_day],
  );
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<AccountEditValues, unknown, AccountUpdate>({
    resolver: zodResolver(schema),
    defaultValues: editValuesOf(account),
  });

  const archive = useArchiveAccount({ spaceId: space.id, onArchived, api });

  const mutation = useMutation({
    mutationFn: (body: AccountUpdate) => updateAccount(api, space.id, account.id, body),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: spaceQueryKey(space.id) });
      toast.success(`Guardaste «${saved.name}»`);
      onDone(true);
    },
    onError: (error) => {
      if (isUnauthorized(error)) {
        window.location.replace("/login");
        return;
      }
      const issues = validationIssuesOf(error);
      let focused = false;
      let unplaced = issues.length === 0;
      for (const issue of issues) {
        const field = Object.hasOwn(FIELD_OF_API_FIELD, issue.path)
          ? FIELD_OF_API_FIELD[issue.path]
          : undefined;
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

  const submit = handleSubmit((body) => {
    if (anyBusy) return;
    setFormError(null);
    if (Object.keys(body).length === 0) {
      onDone(false);
      return;
    }
    mutation.mutate(body);
  });

  const shownError = formError ?? archive.error;
  const fields = (
    <>
      <div className="flex flex-col gap-1 rounded-field bg-primary-soft px-4 py-3.5">
        <span className="text-item font-bold">{describeAccountType(account.type)}</span>
        <span className="text-caption text-muted-foreground">
          El tipo no se cambia después de crear la cuenta.
        </span>
      </div>
      <TextField
        label="Nombre"
        autoComplete="off"
        autoCapitalize="words"
        enterKeyHint={isCard ? "next" : "done"}
        error={errors.name?.message}
        {...register("name")}
      />
      {isCard ? (
        <CardDaysFields
          register={register}
          errors={errors}
          closingName="closingDay"
          dueName="dueDay"
        />
      ) : null}
      {offline ? <Alert title={NETWORK_ERROR.title}>{NETWORK_ERROR.message}</Alert> : null}
      {shownError && !offline ? <Alert title={shownError.title}>{shownError.message}</Alert> : null}
    </>
  );

  const moreActions = (
    <section
      aria-labelledby={actionsId}
      className={cn("flex min-w-0 flex-col gap-2", variant === "page" && "mt-2.5")}
    >
      <h2
        id={actionsId}
        className={cn("text-sm font-bold text-muted-foreground", variant === "page" && "sr-only")}
      >
        Más acciones
      </h2>
      <div className="tile-surface flex flex-col rounded-tile lg:rounded-field">
        <ActionRow
          icon={<Scales />}
          title="Cuadrar saldo"
          help={RECONCILE_HELP[account.type]}
          disabled={anyBusy}
          onClick={onReconcile}
        />
        <ActionRow
          icon={<Archive />}
          title="Archivar cuenta"
          help={`Solo con saldo en ${formatMoney(0, space.currency)}`}
          busy={archive.busy}
          disabled={anyBusy}
          onClick={() => archive.archive(account)}
        />
      </div>
    </section>
  );

  const blockedAlert = archive.blocked ? (
    <ArchiveBlocked
      account={archive.blocked}
      currency={space.currency}
      open={archive.blockedOpen}
      onOpenChange={(next) => {
        if (!next) archive.dismissBlocked();
      }}
      onReconcile={() => {
        archive.dismissBlocked();
        onReconcile();
      }}
    />
  ) : null;

  if (variant === "panel") {
    return (
      <>
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
        {blockedAlert}
      </>
    );
  }

  return (
    <>
      <Card variant="solid" className="gap-4 p-4.5">
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          {fields}
          <Button type="submit" loading={busy} className="mt-1">
            Guardar cambios
          </Button>
        </form>
      </Card>
      {moreActions}
      {blockedAlert}
    </>
  );
}

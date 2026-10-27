"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowsLeftRight } from "@phosphor-icons/react/ssr";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { CategoryGrid } from "@/components/movements/category-grid";
import { CategorySelect } from "@/components/movements/category-select";
import { DateField } from "@/components/movements/date-field";
import { SubcategoryStep } from "@/components/movements/subcategory-step";
import { MORE_SECTIONS } from "@/components/nav-sections";
import { MoneyField } from "@/components/money-field";
import { SegmentedControl } from "@/components/segmented-control";
import { SelectField } from "@/components/select-field";
import { TextField } from "@/components/text-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SheetBody, SheetFooter } from "@/components/ui/sheet";
import { browserApi } from "@/lib/api/browser";
import { buildCategoryTree, categoryNameOf } from "@/lib/core/categories";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { CategoryKind, CategoryRead } from "@/lib/core/data/categories";
import { isUnauthorized } from "@/lib/core/data/errors";
import { spaceQueryKey } from "@/lib/core/data/spaces";
import {
  createTransaction,
  transactionsQueryKey,
  type MovementCreate,
} from "@/lib/core/data/transactions";
import { todayInTimezone } from "@/lib/core/dates";
import { pickDefaultAccountId } from "@/lib/core/default-account";
import {
  MOVEMENT_SAVE_LABEL,
  NETWORK_ERROR,
  TRANSACTION_TYPE_NAMES,
  describeApiError,
  validationIssuesOf,
  type ErrorDescription,
} from "@/lib/core/i18n";
import type { Currency } from "@/lib/core/money";
import { describeRegisteredMovement } from "@/lib/core/movement-label";
import {
  MOVEMENT_TYPES,
  movementFormFieldOf,
  movementFormSchema,
  type MovementFormValues,
} from "@/lib/core/schemas/movement";
import { readLastAccountId, saveLastAccountId } from "@/lib/last-account";
import { cn } from "@/lib/utils";

type MovementType = (typeof MOVEMENT_TYPES)[number];

const TYPE_OPTIONS = MOVEMENT_TYPES.map((value) => ({
  value,
  label: TRANSACTION_TYPE_NAMES[value],
}));

// The example in the description, per type (K-H1-Movimientos and K-V2-Escritorio).
const DESCRIPTION_PLACEHOLDER: Record<MovementType, string> = {
  expense: "Ej.: Supermercado",
  income: "Ej.: Sueldo de octubre",
  transfer: "Ej.: Pago de la tarjeta",
};

const TRANSFER_NOTE =
  "Pagar la tarjeta es una transferencia: no cuenta como gasto. El gasto ya contó cuando compraste.";

const KIND_NAME: Record<CategoryKind, string> = { expense: "gasto", income: "ingreso" };

/** "0,00" for two decimals, "0" for none, "0,000" for three: the placeholder of the amount. */
function zeroAmount(exponent: number): string {
  return exponent === 0 ? "0" : `0,${"0".repeat(exponent)}`;
}

export type MovementFormProps = {
  /** The space the movement is registered in: its id, its currency and its time zone ("hoy" is the space's). */
  space: { id: string; currency: Currency; timezone: string };
  /** The **active** accounts of the space, in the order of the API. At least one: with none the sheet sends the person to "Nueva cuenta". */
  accounts: readonly AccountWithBalance[];
  /** The active categories of the space, principal and sub, flat, as the API sends them. */
  categories: readonly CategoryRead[];
  /**
   * `sheet`: the bottom sheet of a phone (the grid of categories with a second step, the date as
   * chips, one full-width "Guardar" below). `panel`: the side panel of desktop (the grouped `select`,
   * the date input beside "Hoy" and "Ayer", "Cancelar · Guardar" below).
   */
  variant: "sheet" | "panel";
  /**
   * The principal whose subcategories show in the second step (sheet only), or `null` for the form.
   * It lives in the container because the header (the principal's name as title, and "Volver") is
   * the container's.
   */
  picking: string | null;
  onPickingChange: (principalId: string | null) => void;
  /** The movement was registered (the toast is shown): the container closes and refreshes the server data. */
  onDone: () => void;
  /** The "Cancelar" of the panel. */
  onCancel?: () => void;
  /** "Nueva cuenta", from the notice of a transfer with fewer than two accounts. */
  onNeedAccount: () => void;
  /** The API client; the browser's by default. The catalog passes a scripted one to show every state. */
  api?: ApiClient;
};

/**
 * The form of "Registrar movimiento" (docs/diseno.md D17 › Escritorio v2, D19), one component in two
 * containers: the bottom sheet of a phone and the side panel of desktop.
 *
 * - react-hook-form with `movementFormSchema(exponent)`: the form holds text and the schema turns it
 *   into the body of `POST /spaces/{id}/transactions` (the amount as an integer of the minor unit,
 *   each type with its own fields). The amount takes the focus when the form appears.
 * - Gasto and Ingreso: the amount, the category (the grid on a phone, a grouped `select` on desktop)
 *   and the account, which starts on the last one used or the first. Transferencia: "Desde" and
 *   "Hacia" (never the same account) and the note that paying a card is not an expense. Changing the
 *   type clears the category and keeps the rest; "Hacia" is chosen by the form only when there is a
 *   single possible one. The date starts on today in the space's zone; the description is optional.
 * - A transfer needs two active accounts: with one, the form says so and offers "Nueva cuenta". With
 *   no category of the kind, the form says that instead of the grid. In both the button stays off.
 * - A 422 marks the fields it names (`validationIssuesOf` + `movementFormFieldOf`, which drops the
 *   type from the `loc`); an account or a category the backend refuses is also cleared and its list
 *   is asked again. What no field can show goes to an `Alert` in Spanish; a 401 goes to `/login`.
 * - One request at a time (the backend has no `Idempotency-Key` yet): the button is busy while it
 *   runs and after it worked. Without a connection the request waits and the form says so.
 * - On success: the account used is remembered, the accounts and the movements of the space are
 *   invalidated, a toast says "Registraste «…»" (no "Deshacer") and `onDone` runs.
 */
export function MovementForm({
  space,
  accounts,
  categories,
  variant,
  picking,
  onPickingChange,
  onDone,
  onCancel,
  onNeedAccount,
  api = browserApi,
}: MovementFormProps) {
  const queryClient = useQueryClient();
  const { exponent } = space.currency;
  const schema = useMemo(() => movementFormSchema(exponent), [exponent]);
  const [formError, setFormError] = useState<ErrorDescription | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Read once, when the form appears: today in the space's zone and the account to start on.
  const [initial] = useState(() => ({
    today: todayInTimezone(space.timezone),
    accountId: pickDefaultAccountId(accounts, readLastAccountId(space.id)),
  }));

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    setFocus,
    getValues,
    clearErrors,
    control,
    formState: { errors },
  } = useForm<MovementFormValues, unknown, MovementCreate>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: "expense",
      amount: "",
      accountId: initial.accountId,
      toAccountId: "",
      categoryId: "",
      date: initial.today,
      description: "",
    },
  });

  const type = useWatch({ control, name: "type" });
  const accountId = useWatch({ control, name: "accountId" });
  const categoryId = useWatch({ control, name: "categoryId" });
  const isTransfer = type === "transfer";
  const kind: CategoryKind = type === "income" ? "income" : "expense";
  const tree = useMemo(() => buildCategoryTree(categories, kind), [categories, kind]);

  const canTransfer = accounts.length >= 2;
  const noCategories = !isTransfer && tree.length === 0;
  // Nothing the person could do in the form would let it be sent.
  const blocked = noCategories || (isTransfer && !canTransfer);
  const destinations = accounts.filter((account) => account.id !== accountId);

  // The amount is the first thing to type: the focus is there when the form appears.
  useEffect(() => {
    setFocus("amount");
  }, [setFocus]);

  // Leaving the second step of the categories, the focus goes back to the cell that was pressed.
  const wasPicking = useRef(false);
  useEffect(() => {
    if (picking !== null) {
      wasPicking.current = true;
    } else if (wasPicking.current) {
      wasPicking.current = false;
      formRef.current?.querySelector<HTMLElement>("[aria-pressed='true']")?.focus();
    }
  }, [picking]);

  /**
   * "Hacia" can never be the account of "Desde". If it is (or is not an account any more), it is
   * cleared; when only one account is possible, the form chooses it, as there is nothing to decide.
   */
  function syncDestination(from: string) {
    const candidates = accounts.filter((account) => account.id !== from);
    const current = getValues("toAccountId");
    if (current && candidates.some((account) => account.id === current)) return;
    const only = candidates.length === 1 ? candidates[0] : undefined;
    setValue("toAccountId", only ? only.id : "");
  }

  // Set the moment a request is about to start, and let go only if it fails. `busy` below comes from
  // the render before, and `handleSubmit` validates asynchronously: a held Enter fires several
  // submits that all pass the validation before the first render shows the button busy. This is what
  // stops them (the backend has no `Idempotency-Key` yet, so each one would be a duplicate movement).
  const sending = useRef(false);

  const mutation = useMutation({
    mutationFn: ({ body }: { body: MovementCreate; categoryName: string | null }) =>
      createTransaction(api, space.id, body),
    onSuccess: (_saved, { body, categoryName }) => {
      saveLastAccountId(
        space.id,
        body.type === "transfer" ? body.from_account_id : body.account_id,
      );
      // The balances (Inicio and Cuentas) and the list of movements: not the categories.
      void queryClient.invalidateQueries({ queryKey: [...spaceQueryKey(space.id), "accounts"] });
      void queryClient.invalidateQueries({ queryKey: transactionsQueryKey(space.id) });
      const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
      const label = describeRegisteredMovement(body, { category: categoryName, accountNames });
      toast.success(`Registraste «${label}»`);
      onDone();
    },
    onError: (error) => {
      sending.current = false;
      // An expired session is not a form problem: the API client's 401 rule is for queries only.
      if (isUnauthorized(error)) {
        window.location.replace("/login");
        return;
      }
      const issues = validationIssuesOf(error);
      let focused = false;
      let unplaced = issues.length === 0;
      let staleAccounts = false;
      let staleCategories = false;
      for (const issue of issues) {
        const field = movementFormFieldOf(issue.path);
        if (!field) {
          unplaced = true;
          continue;
        }
        // The account or the category the backend refuses is gone or archived: forget it and ask
        // the list again, so the person picks another from what exists now.
        if (field === "categoryId") {
          staleCategories = true;
          setValue("categoryId", "");
        }
        if (field === "accountId" || field === "toAccountId") {
          staleAccounts = true;
          setValue(field, "");
        }
        setError(field, { type: "server", message: issue.message }, { shouldFocus: !focused });
        focused = true;
      }
      if (staleAccounts) {
        void queryClient.invalidateQueries({ queryKey: [...spaceQueryKey(space.id), "accounts"] });
      }
      if (staleCategories) {
        void queryClient.invalidateQueries({
          queryKey: [...spaceQueryKey(space.id), "categories"],
        });
      }
      if (unplaced) setFormError(describeApiError(error));
    },
  });

  // Without a connection TanStack Query does not fail: it pauses the request and sends it when the
  // network is back, so the button would stay busy for good with no word of why. Say it.
  const offline = mutation.isPaused;

  // Busy while it runs and once it worked: the container is leaving, a second tap must not register
  // a second movement.
  const busy = mutation.isPending || mutation.isSuccess;

  function send(body: MovementCreate) {
    if (sending.current || busy) return;
    sending.current = true;
    setFormError(null);
    mutation.mutate({
      body,
      categoryName: body.type === "transfer" ? null : categoryNameOf(tree, body.category_id),
    });
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    if (blocked) {
      event.preventDefault();
      return;
    }
    return handleSubmit(send)(event);
  }

  const panel = variant === "panel";
  const pickingBranch = picking
    ? tree.find((branch) => branch.principal.id === picking)
    : undefined;

  const typeField = (
    <SegmentedControl
      legend={panel ? "Tipo" : <span className="sr-only">Tipo</span>}
      options={TYPE_OPTIONS}
      defaultValue="expense"
      error={errors.type?.message}
      {...register("type", {
        onChange: (event) => {
          const next: unknown = event.target.value;
          setValue("categoryId", "");
          clearErrors("categoryId");
          if (next === "transfer") syncDestination(getValues("accountId"));
        },
      })}
    />
  );

  const amountField = (
    <MoneyField
      size="hero"
      label="Monto"
      currency={space.currency}
      placeholder={zeroAmount(exponent)}
      error={errors.amount?.message}
      {...register("amount")}
    />
  );

  const accountOptions = accounts.map((account) => (
    <option key={account.id} value={account.id}>
      {account.name}
    </option>
  ));

  const accountField = (label: string) => (
    <SelectField
      label={label}
      error={errors.accountId?.message}
      // Empty only after the backend refused the account: then the person has to choose another.
      placeholder={accountId === "" ? "Elige una cuenta" : undefined}
      {...register("accountId", {
        onChange: (event) => syncDestination(event.target.value),
      })}
    >
      {accountOptions}
    </SelectField>
  );

  const destinationField = (
    <SelectField
      label="Hacia"
      placeholder="Elige una cuenta"
      error={errors.toAccountId?.message}
      {...register("toAccountId")}
    >
      {destinations.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name}
        </option>
      ))}
    </SelectField>
  );

  const categoriesLink = MORE_SECTIONS.find((section) => section.href === "/categorias");
  const categoryField = noCategories ? (
    // No category of the kind (the person archived them all): nothing to pick, and where to make one.
    <div
      role="group"
      aria-label="Categoría"
      className="flex flex-col gap-1 rounded-field border border-border bg-card-solid p-4"
    >
      <p className="text-base font-bold">{`No tienes categorías de ${KIND_NAME[kind]} activas`}</p>
      {categoriesLink ? (
        <Link
          href={categoriesLink.href}
          className="w-fit text-sm font-bold text-primary underline underline-offset-4"
        >
          Ir a Categorías
        </Link>
      ) : null}
    </div>
  ) : (
    <Controller
      control={control}
      name="categoryId"
      render={({ field }) =>
        panel ? (
          <CategorySelect
            tree={tree}
            ref={field.ref}
            name={field.name}
            value={field.value}
            onChange={(event) => field.onChange(event.target.value)}
            onBlur={field.onBlur}
            error={errors.categoryId?.message}
          />
        ) : (
          <CategoryGrid
            tree={tree}
            ref={field.ref}
            value={field.value}
            onSelect={(id) => {
              clearErrors("categoryId");
              field.onChange(id);
            }}
            onOpenSubcategories={onPickingChange}
            error={errors.categoryId?.message}
          />
        )
      }
    />
  );

  const transferFields = canTransfer ? (
    <>
      {panel ? (
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">{accountField("Desde")}</div>
          <span aria-hidden className="flex h-12 shrink-0 items-center text-muted-foreground">
            <ArrowsLeftRight className="size-5" />
          </span>
          <div className="min-w-0 flex-1">{destinationField}</div>
        </div>
      ) : (
        <>
          {accountField("Desde")}
          {destinationField}
        </>
      )}
      <p className="rounded-field bg-primary-soft px-3.5 py-3 text-sm leading-snug">
        {TRANSFER_NOTE}
      </p>
    </>
  ) : (
    <Alert
      variant="info"
      title="Necesitas otra cuenta para transferir"
      action={
        <Button type="button" variant="secondary" size="sm" onClick={onNeedAccount}>
          Nueva cuenta
        </Button>
      }
    >
      Una transferencia mueve dinero entre dos de tus cuentas.
    </Alert>
  );

  const fields = (
    <>
      {typeField}
      {amountField}
      {isTransfer ? (
        transferFields
      ) : panel ? (
        <div className="grid grid-cols-2 items-start gap-3">
          {accountField("Cuenta")}
          {categoryField}
        </div>
      ) : (
        <>
          {categoryField}
          {accountField("Cuenta")}
        </>
      )}
      <Controller
        control={control}
        name="date"
        render={({ field }) => (
          <DateField
            ref={field.ref}
            name={field.name}
            value={field.value}
            onChange={(value) => {
              clearErrors("date");
              field.onChange(value);
            }}
            onBlur={field.onBlur}
            today={initial.today}
            variant={variant}
            error={errors.date?.message}
          />
        )}
      />
      <TextField
        label="Descripción"
        optional
        placeholder={DESCRIPTION_PLACEHOLDER[type]}
        autoComplete="off"
        autoCapitalize="sentences"
        enterKeyHint="done"
        error={errors.description?.message}
        {...register("description")}
      />
      {offline ? <Alert title={NETWORK_ERROR.title}>{NETWORK_ERROR.message}</Alert> : null}
      {formError && !offline ? <Alert title={formError.title}>{formError.message}</Alert> : null}
    </>
  );

  const saveLabel = MOVEMENT_SAVE_LABEL[type];

  return (
    <>
      <form
        ref={formRef}
        noValidate
        onSubmit={onSubmit}
        // The form stays mounted while the second step shows, so nothing typed is lost.
        className={cn("flex min-h-0 flex-1 flex-col", picking !== null && "hidden")}
      >
        <SheetBody>{fields}</SheetBody>
        {panel ? (
          <SheetFooter>
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" loading={busy} disabled={blocked}>
              {saveLabel}
            </Button>
          </SheetFooter>
        ) : (
          <SheetFooter className="border-t border-border pt-3">
            <Button type="submit" loading={busy} disabled={blocked} className="w-full">
              {saveLabel}
            </Button>
          </SheetFooter>
        )}
      </form>
      {pickingBranch ? (
        <SubcategoryStep
          branch={pickingBranch}
          value={categoryId}
          onChoose={(id) => {
            clearErrors("categoryId");
            setValue("categoryId", id, { shouldDirty: true });
            onPickingChange(null);
          }}
        />
      ) : null}
    </>
  );
}

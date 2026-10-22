"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { MoneyField } from "@/components/money-field";
import { SegmentedControl } from "@/components/segmented-control";
import { CardDaysFields } from "@/components/accounts/card-days-fields";
import { TextField } from "@/components/text-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SheetBody, SheetFooter } from "@/components/ui/sheet";
import { browserApi } from "@/lib/api/browser";
import type { ApiClient } from "@/lib/core/data/api-client";
import {
  createAccount,
  type AccountCreate,
  type AccountWithBalance,
} from "@/lib/core/data/accounts";
import { isUnauthorized } from "@/lib/core/data/errors";
import { spaceQueryKey } from "@/lib/core/data/spaces";
import {
  ACCOUNT_TYPE_NAMES,
  NETWORK_ERROR,
  describeApiError,
  validationIssuesOf,
  type ErrorDescription,
} from "@/lib/core/i18n";
import type { Currency } from "@/lib/core/money";
import { accountFormSchema, type AccountFormValues } from "@/lib/core/schemas/account";

type AccountType = AccountFormValues["type"];

// What the form says for each kind of account, as the canvas writes it (K-H1-CuentaForm): the
// example name, the label of the balance, and what it means. A card owes, so it asks for the debt
// (written positive) and says it is not an expense.
const COPY: Record<
  AccountType,
  { placeholder: string; balanceLabel: string; balanceHelp: string }
> = {
  bank: {
    placeholder: "Ej.: Itaú",
    balanceLabel: "Saldo actual",
    balanceHelp:
      "Lo que tienes hoy en esta cuenta. Se registra como ajuste: no cuenta como ingreso.",
  },
  cash: {
    placeholder: "Ej.: Billetera",
    balanceLabel: "Saldo actual",
    balanceHelp: "Lo que tienes hoy en efectivo. Se registra como ajuste: no cuenta como ingreso.",
  },
  credit_card: {
    placeholder: "Ej.: Visa Itaú",
    balanceLabel: "Deuda actual",
    balanceHelp: "Lo que debes hoy en la tarjeta. Se registra como ajuste: no cuenta como gasto.",
  },
};

const TYPE_OPTIONS = (Object.keys(ACCOUNT_TYPE_NAMES) as AccountType[]).map((value) => ({
  value,
  label: ACCOUNT_TYPE_NAMES[value],
}));

/** "0,00" for two decimals, "0" for none, "0,000" for three: the placeholder of the amount. */
function zeroAmount(exponent: number): string {
  return exponent === 0 ? "0" : `0,${"0".repeat(exponent)}`;
}

// The field of the form each field of the backend's body is shown on. Anything else a 422 names
// goes to the Alert: the person cannot fix it in a field.
const FIELD_OF_API_FIELD: Readonly<Record<string, keyof AccountFormValues>> = {
  type: "type",
  name: "name",
  initial_balance_minor: "balance",
  closing_day: "closingDay",
  due_day: "dueDay",
};

type AccountFormProps = {
  /** The space the account is created in: its id and its currency (the symbol and the decimals). */
  space: { id: string; currency: Currency };
  /**
   * `page`: the form of `/cuentas/nueva`, below 1024 px, with a full-width "Crear cuenta" at the
   * end. `panel`: inside the side panel (`SheetContent`), with "Cancelar · Crear cuenta" in its
   * footer, bottom right, and the fields in the part that scrolls.
   */
  variant: "page" | "panel";
  /**
   * Called once the account exists (the toast is already shown). The container leaves the form and
   * refreshes the server data (`router.refresh()`), in the order that suits it.
   */
  onDone: (account: AccountWithBalance) => void;
  /** The "Cancelar" of the panel. */
  onCancel?: () => void;
  /** The API client; the browser's by default. The catalog passes a scripted one to show every state. */
  api?: ApiClient;
};

/**
 * The form of a new account (docs/diseno.md D18), one component in two containers: a page below
 * 1024 px and the side panel from 1024 px. Only creating; editing is `AccountEditForm`.
 *
 * - react-hook-form with `accountFormSchema(exponent)`: the form holds text and the schema turns it
 *   into the body of `POST /spaces/{id}/accounts` (the balance as an integer of the minor unit,
 *   the debt of a card negative, the days only on a card). A type is always chosen ("bank").
 * - A 422 from the backend marks the fields it names (`validationIssuesOf`); anything else, or a
 *   field the form does not have, goes to an `Alert` in Spanish (`describeApiError`).
 * - One request at a time: the button is busy while it runs and after it succeeds, until the
 *   container has left the form.
 * - Without a connection the request waits (TanStack Query pauses it) and the form says so, in the
 *   words of any network failure; it goes out by itself when the connection returns.
 * - On success: the queries of the space are invalidated, a toast says "Creaste «…»" and `onDone`
 *   runs. Refreshing the server data (the sidebar and the Inicio come from the server) and leaving
 *   the form are the container's job, because each container leaves differently and the refresh
 *   must come at the right moment (the page returns to the Inicio; the panel closes first).
 */
export function AccountForm({
  space,
  variant,
  onDone,
  onCancel,
  api = browserApi,
}: AccountFormProps) {
  const queryClient = useQueryClient();
  const { exponent } = space.currency;
  const schema = useMemo(() => accountFormSchema(exponent), [exponent]);
  const [formError, setFormError] = useState<ErrorDescription | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<AccountFormValues, unknown, AccountCreate>({
    resolver: zodResolver(schema),
    defaultValues: { type: "bank", name: "", balance: "", closingDay: "", dueDay: "" },
  });

  const type = useWatch({ control, name: "type" });
  const isCard = type === "credit_card";
  const copy = COPY[type] ?? COPY.bank;

  const mutation = useMutation({
    mutationFn: (body: AccountCreate) => createAccount(api, space.id, body),
    onSuccess: (account) => {
      void queryClient.invalidateQueries({ queryKey: spaceQueryKey(space.id) });
      toast.success(`Creaste «${account.name}»`);
      onDone(account);
    },
    onError: (error) => {
      // An expired session is not a form problem: the API client's 401 rule is for queries only.
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

  // Without a connection TanStack Query does not fail: it pauses the request and sends it when the
  // network is back, so the button would stay busy for good with no word of why. Say it.
  const offline = mutation.isPaused;

  // Busy while it runs and once it worked: the container is leaving, a second tap must not create
  // a second account.
  const busy = mutation.isPending || mutation.isSuccess;

  const submit = handleSubmit((body) => {
    if (busy) return;
    setFormError(null);
    mutation.mutate(body);
  });

  const fields = (
    <>
      <SegmentedControl
        legend="Tipo"
        options={TYPE_OPTIONS}
        defaultValue="bank"
        error={errors.type?.message}
        {...register("type")}
      />
      <TextField
        label="Nombre"
        placeholder={copy.placeholder}
        autoComplete="off"
        autoCapitalize="words"
        enterKeyHint="next"
        error={errors.name?.message}
        {...register("name")}
      />
      <MoneyField
        label={copy.balanceLabel}
        description={copy.balanceHelp}
        currency={space.currency}
        tone={isCard ? "debt" : "default"}
        placeholder={zeroAmount(exponent)}
        error={errors.balance?.message}
        {...register("balance")}
      />
      {isCard ? (
        <CardDaysFields
          register={register}
          errors={errors}
          closingName="closingDay"
          dueName="dueDay"
          placeholder="Elige"
        />
      ) : null}
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
            Crear cuenta
          </Button>
        </SheetFooter>
      </form>
    );
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      {fields}
      <Button type="submit" loading={busy} className="mt-1">
        Crear cuenta
      </Button>
    </form>
  );
}

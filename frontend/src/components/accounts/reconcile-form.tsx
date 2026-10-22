"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { AccountIcon } from "@/components/accounts/account-icon";
import { MoneyField } from "@/components/money-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SheetBody, SheetFooter } from "@/components/ui/sheet";
import { browserApi } from "@/lib/api/browser";
import { displayedAmount } from "@/lib/core/accounts-summary";
import { reconcileAccount, type AccountWithBalance } from "@/lib/core/data/accounts";
import type { ApiClient } from "@/lib/core/data/api-client";
import { isUnauthorized } from "@/lib/core/data/errors";
import { spaceQueryKey } from "@/lib/core/data/spaces";
import {
  NETWORK_ERROR,
  describeAccountType,
  describeApiError,
  type ErrorDescription,
} from "@/lib/core/i18n";
import { formatMoney, type Currency } from "@/lib/core/money";
import { RECONCILE_LABEL, describeReconcilePreview, previewReconcile } from "@/lib/core/reconcile";
import { describeMoneyInputIssue } from "@/lib/core/schemas/money-input";
import { cn } from "@/lib/utils";

type ReconcileFormProps = {
  account: AccountWithBalance;
  space: { id: string; currency: Currency };
  /**
   * `panel`: the side panel (the fields scroll, "Cancelar · Cuadrar saldo" below). `sheet`: the
   * bottom sheet of a phone (the button is full width; the sheet adds its own "Cancelar").
   */
  variant: "panel" | "sheet";
  /** The balance was matched (the toast is shown): the container closes. */
  onDone: () => void;
  onCancel?: () => void;
  api?: ApiClient;
};

/**
 * "Cuadrar saldo" (docs/diseno.md D18; K-V2-Cuadrar and K-H1-Cuadrar): the account and its type, the
 * balance Kanza has ("Saldo en Kanza", or "Deuda en Kanza" for a card), a money field with the real
 * balance and, in `aria-live="polite"`, what will be registered. The field starts **empty**.
 *
 * The amount is read in the minor unit and compared with BigInt (`previewReconcile`); a card's real
 * debt is typed positive and sent negative. The backend registers an adjustment for the difference,
 * or nothing: when it already matches, no request is made. On success: the queries of the space are
 * invalidated, a toast says "Cuadraste «…»" and `onDone` runs (the container closes and refreshes).
 */
export function ReconcileForm({
  account,
  space,
  variant,
  onDone,
  onCancel,
  api = browserApi,
}: ReconcileFormProps) {
  const queryClient = useQueryClient();
  const previewId = useId();
  const [text, setText] = useState("");
  const [showIssue, setShowIssue] = useState(false);
  const [formError, setFormError] = useState<ErrorDescription | null>(null);
  const isCard = account.type === "credit_card";
  const { currency } = space;

  // A card paid in excess has a positive balance: a credit in its favor, not a negative debt.
  const inFavor = isCard && account.balance_minor > 0;
  const kanzaLabel = inFavor
    ? "Saldo a favor en Kanza"
    : isCard
      ? "Deuda en Kanza"
      : "Saldo en Kanza";

  const preview = previewReconcile(text, account, currency);

  const mutation = useMutation({
    mutationFn: (balanceMinor: number) =>
      reconcileAccount(api, space.id, account.id, { balance_minor: balanceMinor }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: spaceQueryKey(space.id) });
      toast.success(`Cuadraste «${saved.name}»`);
      onDone();
    },
    onError: (error) => {
      if (isUnauthorized(error)) {
        window.location.replace("/login");
        return;
      }
      setFormError(describeApiError(error));
    },
  });

  const offline = mutation.isPaused;
  const busy = mutation.isPending || mutation.isSuccess;

  function submit(event: React.SyntheticEvent) {
    event.preventDefault();
    if (busy) return;
    setFormError(null);
    if (preview.kind === "empty" || preview.kind === "invalid") {
      setShowIssue(true);
      return;
    }
    if (preview.kind === "same") {
      // Already matches: the backend would register nothing, so nothing is asked of it.
      onDone();
      return;
    }
    mutation.mutate(preview.body.balance_minor);
  }

  const fieldError =
    showIssue && preview.kind === "empty"
      ? describeMoneyInputIssue("empty", { exponent: currency.exponent, debt: isCard })
      : showIssue && preview.kind === "invalid"
        ? preview.message
        : undefined;

  const fields = (
    <>
      <div className="flex min-w-0 items-center gap-3">
        <AccountIcon type={account.type} size="sm" className="size-10.5 rounded-icon" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-item font-bold" title={account.name}>
            {account.name}
          </span>
          <span className="text-caption text-muted-foreground">
            {describeAccountType(account.type)}
          </span>
        </span>
      </div>
      <div className="flex min-w-0 items-baseline justify-between gap-3 rounded-field bg-foreground/6 px-4 py-3.5">
        <span className="shrink-0 text-sm font-bold text-muted-foreground">{kanzaLabel}</span>
        <span
          className={cn(
            "min-w-0 text-right font-heading text-lg font-semibold break-all tabular-nums",
            isCard && !inFavor && "text-debt",
          )}
        >
          {formatMoney(inFavor ? account.balance_minor : displayedAmount(account), currency)}
        </span>
      </div>
      <MoneyField
        label={RECONCILE_LABEL[account.type]}
        currency={currency}
        tone={isCard ? "debt" : "default"}
        placeholder={currency.exponent === 0 ? "0" : `0,${"0".repeat(currency.exponent)}`}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setShowIssue(false);
        }}
        aria-describedby={previewId}
        error={fieldError}
      />
      <p
        id={previewId}
        aria-live="polite"
        className="rounded-field bg-primary-soft px-3.5 py-3 text-sm leading-snug break-words"
      >
        {describeReconcilePreview(preview, account, currency)}
      </p>
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
            Cuadrar saldo
          </Button>
        </SheetFooter>
      </form>
    );
  }

  return (
    <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain">
        {fields}
      </div>
      <Button type="submit" loading={busy} className="w-full">
        Cuadrar saldo
      </Button>
    </form>
  );
}

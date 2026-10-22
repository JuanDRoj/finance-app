"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { useIsDesktop } from "@/components/use-is-desktop";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { browserApi } from "@/lib/api/browser";
import type { ApiClient } from "@/lib/core/data/api-client";
import { currenciesQueryOptions } from "@/lib/core/data/currencies";
import { ApiError, isUnauthorized } from "@/lib/core/data/errors";
import { updateSpaceCurrency } from "@/lib/core/data/spaces";
import {
  CURRENCY_NAMES,
  NETWORK_ERROR,
  describeApiError,
  isErrorResponse,
  orderCurrencies,
} from "@/lib/core/i18n";
import { cn } from "@/lib/utils";

// One retry, not the three of the rest of the app: the person is waiting in front of a skeleton, and
// a list of six currencies that failed twice will not load by insisting. A session that ended (401)
// is not retried either: the answer would be the same.
const CURRENCIES_RETRIES = 1;

const TITLE = "Moneda de tu espacio";
const DESCRIPTION =
  "Todos tus montos usarán esta moneda. Puedes cambiarla hasta que registres tu primer movimiento.";

/** The backend refused because the space already has movements (`PATCH /spaces/{id}`, 409). */
function isCurrencyLocked(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    isErrorResponse(error.body) &&
    error.body.code === "space_has_transactions"
  );
}

type CurrencyPickerProps = {
  /** The space whose currency changes: its id and the currency it has now. */
  space: { id: string; currency: { code: string } };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The code chosen in the list. It lives in the parent, so it survives the window changing width. */
  chosen: string;
  onChoose: (code: string) => void;
  /** The API client; the browser's by default. The catalog passes a scripted one to show every state. */
  api?: ApiClient;
};

/**
 * "Moneda de tu espacio" (docs/diseno.md D18): the six currencies as radios and "Usar esta
 * moneda". A centered dialog from 1024 px and a bottom sheet below it, the same content in both
 * (the width is asked with `useIsDesktop`, which is fine here: it only opens after a tap, when the
 * real width is known).
 *
 * - The list comes from `GET /currencies` when it opens, in the order of `CURRENCY_NAMES`: a
 *   skeleton of six rows while it loads, an `Alert` with "Reintentar" if it fails.
 * - "Usar esta moneda" with the current one chosen just closes: no request.
 * - On success the queries of the spaces are invalidated and the page's server data refreshed (the
 *   sidebar and the card show the new currency), then it closes.
 * - If the space got its first movement meanwhile (409 `space_has_transactions`) an `Alert` says so
 *   inside, the button stays off, and the page is refreshed when the person closes it: the card
 *   disappears then, not under their eyes while they read.
 */
export function CurrencyPicker({
  space,
  open,
  onOpenChange,
  chosen,
  onChoose,
  api = browserApi,
}: CurrencyPickerProps) {
  const desktop = useIsDesktop();
  const router = useRouter();
  const queryClient = useQueryClient();
  const refreshOnClose = useRef(false);

  const currencies = useQuery({
    ...currenciesQueryOptions(api),
    enabled: open,
    retry: (count, error) => !isUnauthorized(error) && count < CURRENCIES_RETRIES,
  });

  const mutation = useMutation({
    mutationFn: (code: string) => updateSpaceCurrency(api, space.id, code),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["spaces"] });
      router.refresh();
      onOpenChange(false);
    },
    onError: (error) => {
      if (isUnauthorized(error)) {
        window.location.replace("/login");
        return;
      }
      if (isCurrencyLocked(error)) refreshOnClose.current = true;
    },
  });

  // Every opening starts without the last attempt's error.
  const { reset } = mutation;
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const locked = isCurrencyLocked(mutation.error);

  function handleOpenChange(next: boolean) {
    if (!next && refreshOnClose.current) {
      refreshOnClose.current = false;
      router.refresh();
    }
    onOpenChange(next);
  }

  function applyChoice() {
    if (chosen === space.currency.code) {
      handleOpenChange(false);
      return;
    }
    mutation.mutate(chosen);
  }

  // Offline TanStack Query does not fail: it pauses the request until the network is back. Without
  // a word the skeleton (or the busy button) would wait for good, so say it. Both resume by
  // themselves, so there is no "Reintentar" here.
  const listWaitsForNetwork = currencies.isPending && currencies.fetchStatus === "paused";
  const changeWaitsForNetwork = mutation.isPaused;

  const ordered = currencies.data ? orderCurrencies(currencies.data) : undefined;

  const body: ReactNode = (
    <div className="flex flex-col gap-3">
      {listWaitsForNetwork ? (
        <Alert title={NETWORK_ERROR.title}>{NETWORK_ERROR.message}</Alert>
      ) : currencies.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <span role="status" className="sr-only">
            Cargando las monedas…
          </span>
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-12.5 w-full rounded-icon" />
          ))}
        </div>
      ) : currencies.isError ? (
        <Alert
          title={describeApiError(currencies.error).title}
          action={
            <Button variant="secondary" size="sm" onClick={() => void currencies.refetch()}>
              Reintentar
            </Button>
          }
        >
          {describeApiError(currencies.error).message}
        </Alert>
      ) : (
        <fieldset
          disabled={mutation.isPending}
          className={cn(
            "m-0 flex min-w-0 flex-col border-0 p-0",
            !desktop && "overflow-hidden rounded-3xl border border-border bg-card-solid",
          )}
        >
          <legend className="sr-only">Moneda</legend>
          {ordered?.map((currency, index) => {
            const name = Object.hasOwn(CURRENCY_NAMES, currency.code)
              ? CURRENCY_NAMES[currency.code]
              : undefined;
            return (
              <label
                key={currency.code}
                className={cn(
                  "flex min-h-13 cursor-pointer items-center gap-3 px-4",
                  desktop && "min-h-12.5 rounded-icon px-3.5",
                  index > 0 && "border-t border-border",
                  chosen === currency.code && "bg-primary/8 dark:bg-primary/12",
                )}
              >
                {/* The sheet of a phone writes the name at 16 px and the code in bold; the desktop
                    dialog, as in the canvas, the name at 15 px and the code at 14 px, plain. */}
                <span
                  className={cn(
                    "min-w-0 flex-1 wrap-anywhere",
                    desktop ? "text-item" : "text-base",
                    chosen === currency.code ? "font-bold" : "font-medium",
                  )}
                >
                  {name ?? currency.code}
                </span>
                {name ? (
                  <span
                    className={cn(
                      "text-sm text-muted-foreground",
                      desktop ? "font-normal" : "font-bold tabular-nums",
                    )}
                  >
                    {currency.code}
                  </span>
                ) : null}
                <input
                  type="radio"
                  name="currency"
                  value={currency.code}
                  checked={chosen === currency.code}
                  onChange={() => onChoose(currency.code)}
                  className={cn("shrink-0 accent-primary", desktop ? "size-4.5" : "size-5.5")}
                />
              </label>
            );
          })}
        </fieldset>
      )}
      {changeWaitsForNetwork ? (
        <Alert title={NETWORK_ERROR.title}>{NETWORK_ERROR.message}</Alert>
      ) : null}
      {mutation.isError && !isUnauthorized(mutation.error) ? (
        <Alert title={describeApiError(mutation.error).title}>
          {describeApiError(mutation.error).message}
        </Alert>
      ) : null}
    </div>
  );

  const primaryButton = (className?: string) => (
    <Button
      size={desktop ? "sm" : "default"}
      className={className}
      loading={mutation.isPending}
      disabled={!ordered || locked}
      onClick={applyChoice}
    >
      Usar esta moneda
    </Button>
  );

  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{TITLE}</DialogTitle>
            <DialogDescription>{DESCRIPTION}</DialogDescription>
          </DialogHeader>
          {body}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" size="sm" />}>Cancelar</DialogClose>
            {primaryButton()}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader showClose={false}>
          <SheetTitle className="text-xl">{TITLE}</SheetTitle>
          <SheetDescription>{DESCRIPTION}</SheetDescription>
        </SheetHeader>
        <SheetBody>{body}</SheetBody>
        <SheetFooter>{primaryButton("w-full")}</SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

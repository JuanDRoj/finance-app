"use client";

import { ArrowLeft } from "@phosphor-icons/react/ssr";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { MovementForm } from "@/components/movements/movement-form";
import { useKeyboardInset } from "@/components/movements/use-keyboard-inset";
import { useIsDesktop } from "@/components/use-is-desktop";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { browserApi } from "@/lib/api/browser";
import { accountsQueryOptions } from "@/lib/core/data/accounts";
import type { ApiClient } from "@/lib/core/data/api-client";
import { categoriesQueryOptions } from "@/lib/core/data/categories";
import { describeApiError } from "@/lib/core/i18n";
import type { Currency } from "@/lib/core/money";

type MovementSheetProps = {
  /** Whether it is showing. It stays mounted while it leaves, so the exit animation plays. */
  open: boolean;
  /** The space the movement is registered in (`timezone`: "hoy" is the space's, never the device's). */
  space: { id: string; currency: Currency; timezone: string };
  /** Closes it: "Cerrar", "Cancelar", Escape and the veil. */
  onClose: () => void;
  /** A movement was registered (the toast is shown): the host closes and refreshes the server data. */
  onSaved: () => void;
  /** The space has no active account, so there is nothing to register on: the host opens "Nueva cuenta". */
  onNoAccounts: () => void;
  /** The API client; the browser's by default (the catalog scripts one). */
  api?: ApiClient;
};

/**
 * Below 1024 px the sheet is tall (36 px from the top, or the safe area plus 8 px, which is more),
 * so the category and the account stay in view above the keyboard (docs/diseno.md D19). It is
 * placed by `top` and `bottom`, not by a height, so lifting the bottom for the keyboard shrinks it.
 * From 768 px it is centered and at most 640 px wide (the canvas has no tablet).
 */
const TALL_SHEET =
  "top-[max(2.25rem,calc(env(safe-area-inset-top,0px)+0.5rem))] max-h-none md:mx-auto md:max-w-160";

/** The amount, where the focus starts when the form is already there as the sheet opens. */
function startOnTheAmount(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    "[data-slot='sheet-content'] input[inputmode='decimal']",
  );
}

function FormSkeleton() {
  return (
    <SheetBody role="status" aria-busy="true" aria-label="Cargando">
      <Skeleton className="h-11 w-full rounded-full" />
      <Skeleton className="h-15 w-full rounded-field" />
      <Skeleton className="h-28 w-full rounded-field" />
      <Skeleton className="h-13 w-full rounded-field" />
      <Skeleton className="h-13 w-full rounded-field" />
    </SheetBody>
  );
}

/**
 * "Registrar movimiento" (docs/diseno.md D17 › Escritorio v2, D19): the `Sheet` in its two shapes,
 * the bottom sheet below 1024 px and the side panel from there, with the form inside. The host
 * (`MovementPanelHost`) mounts it when the URL asks for `?movimiento=nuevo`; it loads with
 * `next/dynamic`, so nothing of it is in the bundle of a screen until then.
 *
 * - **Data.** It asks for the accounts (the same list Cuentas hydrates, archived ones included, kept
 *   active here) and the categories, only while it is open. While they load the body is a skeleton;
 *   if one fails, an `Alert` with "Reintentar" (nothing is lost). With **no active account** it asks
 *   the host to open "Nueva cuenta" instead (`onNoAccounts`).
 * - **Phone.** The title is "Registrar movimiento"; in the second step of the categories it is the
 *   principal's name, with a "Volver" before it. The button below the form stays above the keyboard
 *   (`useKeyboardInset` lifts the bottom of the sheet where the browser does not shrink the page).
 * - **Focus.** On the amount, as the form appears. Closing returns it to what opened the sheet.
 */
export function MovementSheet({
  open,
  space,
  onClose,
  onSaved,
  onNoAccounts,
  api = browserApi,
}: MovementSheetProps) {
  const desktop = useIsDesktop();
  const keyboardInset = useKeyboardInset(open && !desktop);
  const [picking, setPicking] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    // A sheet that opens again starts on the form, not on the second step it was closed in.
    if (!open) setPicking(null);
  }

  const accountsQuery = useQuery({
    ...accountsQueryOptions(api, space.id, { includeArchived: true }),
    enabled: open,
  });
  const categoriesQuery = useQuery({ ...categoriesQueryOptions(api, space.id), enabled: open });
  const accounts = useMemo(
    () => accountsQuery.data?.filter((account) => account.archived_at === null),
    [accountsQuery.data],
  );
  const categories = categoriesQuery.data;
  const noAccounts = accounts !== undefined && accounts.length === 0;

  useEffect(() => {
    if (open && noAccounts) onNoAccounts();
  }, [open, noAccounts, onNoAccounts]);

  // The second step exists only on the phone (the panel has a `select`): a window widened to
  // 1024 px while it shows goes back to the form.
  const step = desktop ? null : picking;
  const principalName = step
    ? categories?.find((category) => category.id === step)?.name
    : undefined;
  const title = principalName ?? "Registrar movimiento";

  let body;
  if (accounts && accounts.length > 0 && categories) {
    body = (
      <MovementForm
        space={space}
        accounts={accounts}
        categories={categories}
        variant={desktop ? "panel" : "sheet"}
        picking={step}
        onPickingChange={setPicking}
        onDone={onSaved}
        onCancel={onClose}
        onNeedAccount={onNoAccounts}
        api={api}
      />
    );
  } else if (accountsQuery.isError || categoriesQuery.isError) {
    const { title: errorTitle, message } = describeApiError(
      accountsQuery.isError ? accountsQuery.error : categoriesQuery.error,
    );
    body = (
      <SheetBody>
        <Alert
          title={errorTitle}
          action={
            <Button
              variant="secondary"
              size="sm"
              loading={accountsQuery.isFetching || categoriesQuery.isFetching}
              onClick={() => {
                if (accountsQuery.isError) void accountsQuery.refetch();
                if (categoriesQuery.isError) void categoriesQuery.refetch();
              }}
            >
              Reintentar
            </Button>
          }
        >
          {message}
        </Alert>
      </SheetBody>
    );
  } else {
    body = <FormSkeleton />;
  }

  const lifted: CSSProperties | undefined =
    keyboardInset > 0 ? { bottom: keyboardInset, paddingBottom: "0.75rem" } : undefined;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side={desktop ? "right" : "bottom"}
        // The bottom sheet closes with the "Cerrar" of its header; no "Cancelar" under the button.
        closeLabel={null}
        initialFocus={startOnTheAmount}
        className={desktop ? undefined : TALL_SHEET}
        style={lifted}
      >
        <SheetHeader>
          <div className="flex min-w-0 items-center gap-2">
            {step ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Volver"
                className="bg-foreground/6 hover:bg-foreground/10"
                onClick={() => setPicking(null)}
              >
                <ArrowLeft aria-hidden />
              </Button>
            ) : null}
            <SheetTitle>{title}</SheetTitle>
          </div>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  );
}

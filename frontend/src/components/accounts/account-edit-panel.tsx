"use client";

import { ArrowLeft } from "@phosphor-icons/react/ssr";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AccountEditForm } from "@/components/accounts/account-edit-form";
import { ReconcileForm } from "@/components/accounts/reconcile-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { browserApi } from "@/lib/api/browser";
import { accountsQueryOptions } from "@/lib/core/data/accounts";
import type { ApiClient } from "@/lib/core/data/api-client";
import { describeApiError } from "@/lib/core/i18n";
import type { Currency } from "@/lib/core/money";
import type { AccountPanelView } from "@/components/accounts/panel-url";

type AccountEditPanelProps = {
  /** Whether the panel is showing. It stays mounted while it leaves, so the exit animation plays. */
  open: boolean;
  /** Which of its two views: the edit form or "Cuadrar saldo". */
  view: AccountPanelView;
  space: { id: string; currency: Currency };
  /** The account (`?sel`). */
  accountId: string;
  /** Asks the host to show the other view (it writes `?cuenta=` in the URL). */
  onView: (view: AccountPanelView) => void;
  onClose: () => void;
  /** The API client; the browser's by default (the catalog scripts one). */
  api?: ApiClient;
};

/** The first field of the view: where the focus starts. */
const FIRST_FIELD: Record<AccountPanelView, string> = {
  editar: "input[name='name']",
  cuadrar: "input[inputmode='decimal']",
};

function titleOfTheScreen(): HTMLElement | null {
  return document.querySelector<HTMLElement>("h1");
}

function PanelSkeleton() {
  return (
    <SheetBody role="status" aria-busy="true" aria-label="Cargando la cuenta">
      <Skeleton className="h-16 w-full rounded-field" />
      <Skeleton className="h-13 w-full rounded-field" />
      <Skeleton className="h-13 w-full rounded-field" />
      <Skeleton className="h-30 w-full rounded-field" />
    </SheetBody>
  );
}

/**
 * The side panel of an existing account (docs/diseno.md D17 › Escritorio v2, D18): "Editar cuenta"
 * and "Cuadrar saldo" in the **same** `Sheet`, so switching between them does not close and open the
 * panel. `AccountPanelHost` mounts it for `?cuenta=editar|cuadrar` and `?sel=<id>`.
 *
 * - The account comes from the accounts query of the space (the page hydrated it), asked again if it
 *   is not there. While it loads the body is a skeleton; if it fails, an `Alert` with "Reintentar"
 *   (the panel stays: nothing is lost). An account that is not there (or is archived) closes the panel.
 * - "Cuadrar saldo" from the edit view (or from the alert of archiving) shows "Volver" to the edit
 *   view; from the header of the detail it does not. After matching the balance the panel closes
 *   whichever way it was reached.
 * - The focus goes to the first field of each view. When the panel closes after saving, archiving or
 *   matching, the page's changed: the focus goes to the title of the screen and the server data is
 *   refreshed *after* closing, so the refresh already renders the URL without `?cuenta=`.
 */
export function AccountEditPanel({
  open,
  view,
  space,
  accountId,
  onView,
  onClose,
  api = browserApi,
}: AccountEditPanelProps) {
  const router = useRouter();
  const finished = useRef(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const query = useQuery({
    ...accountsQueryOptions(api, space.id, { includeArchived: true }),
    enabled: open,
  });
  const account = query.data?.find((item) => item.id === accountId && item.archived_at === null);
  const missing = query.isSuccess && !account;

  useEffect(() => {
    if (open) finished.current = false;
  }, [open]);

  // An account that is gone (archived elsewhere, or a stale link): nothing to show.
  useEffect(() => {
    if (open && missing) onClose();
  }, [open, missing, onClose]);

  // The first field of the view, once the account is there and each time the view changes.
  const ready = account !== undefined;
  useEffect(() => {
    if (!open || !ready) return;
    document
      .querySelector<HTMLElement>(`[data-slot='sheet-content'] ${FIRST_FIELD[view]}`)
      ?.focus();
  }, [open, ready, view]);

  function close() {
    setCanGoBack(false);
    onClose();
  }

  function finish() {
    finished.current = true;
    close();
    router.refresh();
  }

  function goTo(next: AccountPanelView) {
    // "Volver" exists only when the reconcile view was reached from the edit view.
    setCanGoBack(next === "cuadrar" && view === "editar");
    onView(next);
  }

  const title = view === "editar" ? "Editar cuenta" : "Cuadrar saldo";

  let body;
  if (account) {
    body =
      view === "editar" ? (
        <AccountEditForm
          key={account.id}
          account={account}
          space={space}
          variant="panel"
          onDone={(saved) => (saved ? finish() : close())}
          onArchived={finish}
          onReconcile={() => goTo("cuadrar")}
          onCancel={close}
          api={api}
        />
      ) : (
        <ReconcileForm
          key={account.id}
          account={account}
          space={space}
          variant="panel"
          onDone={finish}
          onCancel={close}
          api={api}
        />
      );
  } else if (query.isError) {
    const { title: errorTitle, message } = describeApiError(query.error);
    body = (
      <SheetBody>
        <Alert
          title={errorTitle}
          action={
            <Button
              variant="secondary"
              size="sm"
              loading={query.isFetching}
              onClick={() => void query.refetch()}
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
    body = <PanelSkeleton />;
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <SheetContent side="right" finalFocus={() => (finished.current ? titleOfTheScreen() : true)}>
        <SheetHeader>
          <div className="flex min-w-0 items-center gap-2">
            {view === "cuadrar" && canGoBack ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Volver"
                className="bg-foreground/6 hover:bg-foreground/10"
                onClick={() => goTo("editar")}
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

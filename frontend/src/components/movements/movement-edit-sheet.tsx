"use client";

import { ArrowLeft } from "@phosphor-icons/react/ssr";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { MovementDetail } from "@/components/movements/movement-detail";
import { MovementForm } from "@/components/movements/movement-form";
import { findMovementLink } from "@/components/movements/movement-link";
import { TALL_SHEET, startOnTheAmount } from "@/components/movements/sheet-layout";
import { useDeleteMovement } from "@/components/movements/use-delete-movement";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsDesktop } from "@/components/use-is-desktop";
import { useKeyboardInset } from "@/components/use-keyboard-inset";
import { browserApi } from "@/lib/api/browser";
import { accountsQueryOptions, type AccountWithBalance } from "@/lib/core/data/accounts";
import type { ApiClient } from "@/lib/core/data/api-client";
import { categoriesQueryOptions, type CategoryRead } from "@/lib/core/data/categories";
import { ApiError } from "@/lib/core/data/errors";
import {
  transactionDetailQueryOptions,
  transactionsQueryKey,
  type MovementRead,
} from "@/lib/core/data/transactions";
import { todayInTimezone } from "@/lib/core/dates";
import { NETWORK_ERROR, describeApiError, describeMovementError } from "@/lib/core/i18n";
import type { Currency } from "@/lib/core/money";
import {
  archivedAccountsOf,
  describeMovementDetailTitle,
  movementDetailKind,
} from "@/lib/core/movements";

type MovementEditSheetProps = {
  /** Whether it is showing. It stays mounted while it leaves, so the exit animation plays. */
  open: boolean;
  /** The space the movement is in (`timezone`: "hoy" is the space's, never the device's). */
  space: { id: string; currency: Currency; timezone: string };
  /** The movement it opens (`?movimiento=editar&id=`): a UUID, the host checks it. */
  movementId: string;
  /** Closes with nothing changed: "Cerrar", "Cancelar", Escape, the veil, "Guardar cambios" with no changes. */
  onClose: () => void;
  /** The changes were saved (the toast is shown): the host closes first and refreshes the server data after. */
  onSaved: () => void;
  /** The movement was deleted (the toast with "Deshacer" is shown): the host closes; the hook refreshes. */
  onDeleted: () => void;
  /** The sheet finished leaving: the host may unmount it. */
  onExited?: () => void;
  /** The API client; the browser's by default (the catalog scripts one). */
  api?: ApiClient;
};

/** What the sheet shows, all of it ready: the movement and the lists it needs. */
type Snapshot = {
  movement: MovementRead;
  accounts: AccountWithBalance[];
  categories: CategoryRead[];
};

function titleOfTheScreen(): HTMLElement | null {
  return document.querySelector<HTMLElement>("h1");
}

function EditSkeleton() {
  return (
    <SheetBody role="status" aria-busy="true" aria-label="Cargando el movimiento">
      <Skeleton className="h-16 w-full rounded-field" />
      <Skeleton className="h-15 w-full rounded-field" />
      <Skeleton className="h-28 w-full rounded-field" />
      <Skeleton className="h-13 w-full rounded-field" />
      <Skeleton className="h-13 w-full rounded-field" />
    </SheetBody>
  );
}

/**
 * "Editar movimiento" (docs/diseno.md D17 › Escritorio v2, D19; K-H1-Movimientos `editar` and `ajuste`,
 * K-V2-Escritorio `editarMov` and `ajuste`): the `Sheet` in its two shapes, the bottom sheet below
 * 1024 px and the side panel from there. `MovementPanelHost` mounts it for `?movimiento=editar&id=`
 * (with `next/dynamic`) and unmounts it when it has left, so every opening starts from a fresh `GET`
 * and a form that starts afresh.
 *
 * - **Data.** The movement by its id (`GET`: always fresh, see `transactionDetailQueryOptions`; the form
 *   is drawn only from an answer of **this** opening, `isFetchedAfterMount`, never from a copy that an
 *   earlier opening left in the cache) and the
 *   accounts and the categories of the space with their archived ones (the lists Movimientos hydrates,
 *   so it usually opens without waiting). Its kind (`movementDetailKind`) says what it shows: the form
 *   `MovementForm mode="edit"`, or the read-only `MovementDetail` of an adjustment, a pending or a
 *   skipped movement and one of an archived account.
 * - **States.** Loading is a skeleton. A **404** (the movement is gone, deleted, or of another space: the
 *   API says the same for the three) is an `Alert` "No encontramos ese movimiento" with no retry, and the
 *   lists on screen are asked again (they still show it). Any other failure is an `Alert` with
 *   "Reintentar"; without a connection the queries wait instead of failing, which would leave a
 *   skeleton for good, so that is said too ("No pudimos conectar").
 * - **Leaving.** Saving, deleting and closing do not stop the data from changing under the sheet: saving
 *   invalidates the movements (the detail included) and deleting takes the detail out of the cache. So
 *   the sheet keeps a **snapshot** of what it showed and, as soon as it is leaving (`!open` or `leaving`,
 *   which the callbacks set at once), it draws the snapshot and stops asking: the body never flashes a
 *   skeleton or a 404 while it fades.
 * - **Focus.** On the amount as the form appears. Closing without changes gives it back to the link of
 *   the movement that opened it (`findMovementLink`: the visible one); saving or deleting changes the
 *   screen (the row may move or go), so it goes to the title of the screen.
 */
export function MovementEditSheet({
  open,
  space,
  movementId,
  onClose,
  onSaved,
  onDeleted,
  onExited,
  api = browserApi,
}: MovementEditSheetProps) {
  const desktop = useIsDesktop();
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState<string | null>(null);
  const [today] = useState(() => todayInTimezone(space.timezone));
  // Saved or deleted from here: the lists are about to change under the sheet.
  const [leaving, setLeaving] = useState(false);
  const finished = useRef(false);
  const frozen = !open || leaving;

  const detail = useQuery({
    ...transactionDetailQueryOptions(api, space.id, movementId),
    enabled: !frozen,
  });
  const accountsQuery = useQuery({
    ...accountsQueryOptions(api, space.id, { includeArchived: true }),
    enabled: !frozen,
  });
  const categoriesQuery = useQuery({
    ...categoriesQueryOptions(api, space.id, { includeArchived: true }),
    enabled: !frozen,
  });

  // What this opening got from the server. `detail.data` alone is not enough: with `gcTime: 0` the query
  // of an earlier opening of the same movement can still be in the cache for a moment (the host
  // unmounted the last sheet an instant ago), and the form reads its values **once**: it would start on
  // the old ones, and the next "Guardar cambios" would silently undo the edit made in between.
  // `isFetchedAfterMount` is true only once a `GET` of **this** sheet has answered; until then it is
  // the skeleton, as for a movement never asked for.
  const fresh = detail.isFetchedAfterMount;
  const live = useMemo<Snapshot | null>(
    () =>
      detail.data && fresh && accountsQuery.data && categoriesQuery.data
        ? {
            movement: detail.data,
            accounts: accountsQuery.data,
            categories: categoriesQuery.data,
          }
        : null,
    [detail.data, fresh, accountsQuery.data, categoriesQuery.data],
  );
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  if (!frozen && snapshot !== live) setSnapshot(live);
  const ready = frozen ? snapshot : live;

  const { remove, pendingIds } = useDeleteMovement({
    spaceId: space.id,
    api,
    onDeleted: () => {
      finished.current = true;
      setLeaving(true);
      onDeleted();
    },
  });

  const keyboardInset = useKeyboardInset(!frozen && !desktop);

  // The API says the same 404 for a movement that is gone, deleted or of another space. (A 422, an id
  // that is not a UUID, cannot get here: the host checks it. It would be the generic failure.)
  const notFound = !ready && detail.error instanceof ApiError && detail.error.status === 404;

  // The movement is gone: the list on screen still shows it. The detail is left out on purpose: it
  // is the one that said 404, and asking it again would only say it again.
  useEffect(() => {
    if (!frozen && notFound) {
      void queryClient.invalidateQueries({
        queryKey: transactionsQueryKey(space.id),
        predicate: (query) => query.queryKey[3] !== "detail",
      });
    }
  }, [frozen, notFound, queryClient, space.id]);

  const kind = ready ? movementDetailKind(ready.movement, ready.accounts) : undefined;
  const readOnly = kind !== undefined && kind !== "editable";
  const step = desktop ? null : picking;
  const principalName = step
    ? ready?.categories.find((category) => category.id === step)?.name
    : undefined;
  const title =
    principalName ??
    (readOnly && ready ? describeMovementDetailTitle(ready.movement) : "Editar movimiento");

  const failedQuery =
    !ready && !notFound
      ? [detail, accountsQuery, categoriesQuery].find((query) => query.isError)
      : undefined;
  const paused =
    !ready &&
    !notFound &&
    !failedQuery &&
    [detail, accountsQuery, categoriesQuery].some((query) => query.fetchStatus === "paused");

  let body;
  if (ready && kind) {
    body =
      kind === "editable" ? (
        <MovementForm
          mode="edit"
          movement={ready.movement}
          space={space}
          accounts={ready.accounts.filter((account) => account.archived_at === null)}
          categories={ready.categories}
          variant={desktop ? "panel" : "sheet"}
          picking={step}
          onPickingChange={setPicking}
          onDone={() => {
            finished.current = true;
            setLeaving(true);
            onSaved();
          }}
          onUnchanged={onClose}
          onCancel={onClose}
          onNeedAccount={onClose}
          onDelete={() => remove(ready.movement)}
          deleting={pendingIds.has(ready.movement.id)}
          api={api}
        />
      ) : (
        <MovementDetail
          movement={ready.movement}
          kind={kind}
          currency={space.currency}
          today={today}
          archivedAccounts={archivedAccountsOf(ready.movement, ready.accounts)}
          variant={desktop ? "panel" : "sheet"}
          onClose={onClose}
        />
      );
  } else if (notFound) {
    const { title: errorTitle, message } = describeMovementError(detail.error, "update");
    body = (
      <SheetBody>
        <Alert
          title={errorTitle}
          action={
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cerrar
            </Button>
          }
        >
          {message}
        </Alert>
      </SheetBody>
    );
  } else if (failedQuery) {
    const { title: errorTitle, message } = describeApiError(failedQuery.error);
    body = (
      <SheetBody>
        <Alert
          title={errorTitle}
          action={
            <Button
              variant="secondary"
              size="sm"
              loading={failedQuery.isFetching}
              onClick={() => void failedQuery.refetch()}
            >
              Reintentar
            </Button>
          }
        >
          {message}
        </Alert>
      </SheetBody>
    );
  } else if (paused) {
    body = (
      <SheetBody>
        <Alert
          title={NETWORK_ERROR.title}
          action={
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cerrar
            </Button>
          }
        >
          {NETWORK_ERROR.message}
        </Alert>
      </SheetBody>
    );
  } else {
    body = <EditSkeleton />;
  }

  // Tall for the form (and while it loads, so the sheet does not jump); short for what only reads or failed.
  const tall = !desktop && (ready ? kind === "editable" : !notFound && !failedQuery && !paused);
  const lifted: CSSProperties | undefined =
    keyboardInset > 0 && tall ? { bottom: keyboardInset, paddingBottom: "0.75rem" } : undefined;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) onExited?.();
      }}
    >
      <SheetContent
        side={desktop ? "right" : "bottom"}
        // The bottom sheet closes with the "Cerrar" of its header; no "Cancelar" under the button.
        closeLabel={null}
        initialFocus={startOnTheAmount}
        finalFocus={() =>
          finished.current
            ? (titleOfTheScreen() ?? true)
            : (findMovementLink(movementId) ?? titleOfTheScreen() ?? true)
        }
        className={tall ? TALL_SHEET : undefined}
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

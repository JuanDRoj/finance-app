"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { browserApi } from "@/lib/api/browser";
import type { ApiClient } from "@/lib/core/data/api-client";
import { ApiError, isUnauthorized } from "@/lib/core/data/errors";
import { spaceQueryKey } from "@/lib/core/data/spaces";
import {
  deleteTransaction,
  removeMovementFromListCache,
  restoreTransaction,
  transactionDetailKey,
  transactionsQueryKey,
} from "@/lib/core/data/transactions";
import { describeMovementError } from "@/lib/core/i18n";
import { describeMovementLabel } from "@/lib/core/movement-label";
import type { MovementLike } from "@/lib/core/movements";

/** How long the toast "Eliminaste «…»" lasts, so "Deshacer" can be reached (docs/diseno.md D8). */
export const DELETE_TOAST_MS = 6000;

/** How long the toast of a failed "Deshacer" lasts: it carries "Reintentar", the last way back. */
export const UNDO_FAILED_TOAST_MS = 10_000;

/** A movement to delete: its id and what the toast calls it (any list item or detail has both). */
export type DeletableMovement = MovementLike & { id: string };

type UseDeleteMovementOptions = {
  spaceId: string;
  /**
   * Called once the movement is deleted, **after** the toast is shown and the lists are updated:
   * close the sheet or panel it was deleted from, or move the focus off the row that left. The
   * refresh of the server data (`router.refresh()`) comes after, so a container that closes here
   * has already written the URL without its param when the refresh renders it.
   */
  onDeleted?: (movement: DeletableMovement) => void;
  api?: ApiClient;
};

/**
 * "Eliminar movimiento" (docs/diseno.md D8, D17 › Escritorio v2, D19): `DELETE .../transactions/{id}`
 * with **no confirmation**. The toast "Eliminaste «Café»" with **Deshacer** is the way back.
 *
 * - **Deleted.** The movement leaves the lists in the cache at once (`removeMovementFromListCache`),
 *   and its detail is taken out of it (`removeQueries`) before the lists are asked again: the
 *   invalidation reaches the detail too (its key hangs from the root of the movements), and a sheet
 *   that is still mounted would ask the server for a movement that is deleted and get a 404. (Saving
 *   with `PUT` is different: asking for the detail again is right there.) The balances
 *   (`["spaces", id, "accounts"]`) and the movements (`transactionsQueryKey`: list, summary) are asked
 *   again, the toast is shown, `onDeleted` runs and the server data of the page (the Inicio, the page
 *   of an account) is refreshed.
 * - **Deshacer** is `POST .../restore`. It is a closure over the client and the router, so it works
 *   after the sheet or the row that deleted is gone (the toast outlives them), and a toast undoes once
 *   (a quick double tap restores once). On success it asks the lists and the balances again and
 *   refreshes, and says nothing: the row coming back and the count the screen announces are the
 *   confirmation. If it fails: a 409 `account_archived` (the account was archived meanwhile) explains
 *   how to get out of it; no connection or a 5xx offer **Reintentar** for 10 s; a 401 goes to `/login`.
 * - **Failures to delete** are a toast in Spanish (the 404 and 409 ask the lists again: what is on
 *   screen is old). A 401 goes to `/login`.
 * - **Offline.** `networkMode: "always"`: without a connection the request fails at once and says so,
 *   instead of waiting in the queue and deleting minutes later without the person looking.
 * - **One at a time per movement.** A movement already being deleted (or deleted and not undone) is
 *   not sent again; another movement is. The hook can be shared by every row of a list.
 *
 * `pendingId` is the movement being deleted now, to put a busy state on its button. With several in
 * flight it is the last one asked for, and a delete that ends clears it only if it is still its own.
 */
export function useDeleteMovement({
  spaceId,
  onDeleted,
  api = browserApi,
}: UseDeleteMovementOptions) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Set before `mutate` (state comes from the render before, and a second tap would still find the
  // button enabled), released if the delete fails or the toast undoes it.
  const deleted = useRef(new Set<string>());

  function refreshLists() {
    void queryClient.invalidateQueries({ queryKey: [...spaceQueryKey(spaceId), "accounts"] });
    void queryClient.invalidateQueries({ queryKey: transactionsQueryKey(spaceId) });
  }

  function undo(movement: DeletableMovement, release: () => void) {
    restoreTransaction(api, spaceId, movement.id)
      .then(() => {
        deleted.current.delete(movement.id);
        refreshLists();
        router.refresh();
      })
      .catch((failure: unknown) => {
        release();
        if (isUnauthorized(failure)) {
          window.location.replace("/login");
          return;
        }
        const { message } = describeMovementError(failure, "restore");
        // Without a connection or on a server failure, trying again can work; the other answers
        // (the account is archived, the movement is gone) will not change by asking again.
        const retryable = !(failure instanceof ApiError) || failure.status >= 500;
        toast.error("No se pudo deshacer", {
          description: message,
          ...(retryable
            ? {
                duration: UNDO_FAILED_TOAST_MS,
                action: { label: "Reintentar", onClick: () => undo(movement, release) },
              }
            : {}),
        });
      });
  }

  const mutation = useMutation({
    networkMode: "always",
    mutationFn: (movement: DeletableMovement) => deleteTransaction(api, spaceId, movement.id),
    onSuccess: (_result, movement) => {
      // Only this movement stops being busy: another one may still be on its way.
      setPendingId((current) => (current === movement.id ? null : current));
      removeMovementFromListCache(queryClient, spaceId, movement.id);
      // The detail of a movement that no longer exists would be a 404 (`GET` of a deleted one): take
      // it out before the invalidation below, which reaches it (its key hangs from the movements' root)
      // and would make a sheet that is still mounted ask for it again.
      queryClient.removeQueries({ queryKey: transactionDetailKey(spaceId, movement.id) });
      refreshLists();
      // "Deshacer" of this toast only: a flag of its own, because the toast outlives the sheet and a
      // quick double tap must restore once. Released if the restore fails, so "Reintentar" works.
      let undoing = false;
      toast.success(`Eliminaste «${describeMovementLabel(movement)}»`, {
        duration: DELETE_TOAST_MS,
        action: {
          label: "Deshacer",
          onClick: () => {
            if (undoing) return;
            undoing = true;
            undo(movement, () => {
              undoing = false;
            });
          },
        },
      });
      onDeleted?.(movement);
      router.refresh();
    },
    onError: (failure, movement) => {
      setPendingId((current) => (current === movement.id ? null : current));
      deleted.current.delete(movement.id);
      if (isUnauthorized(failure)) {
        window.location.replace("/login");
        return;
      }
      // Gone or no longer deletable: what is on screen is old.
      if (failure instanceof ApiError && (failure.status === 404 || failure.status === 409)) {
        refreshLists();
      }
      const { title, message } = describeMovementError(failure, "delete");
      toast.error(title, { description: message });
    },
  });
  const { mutate } = mutation;

  const remove = useCallback(
    (movement: DeletableMovement) => {
      if (deleted.current.has(movement.id)) return;
      deleted.current.add(movement.id);
      setPendingId(movement.id);
      mutate(movement);
    },
    [mutate],
  );

  return { remove, pendingId };
}

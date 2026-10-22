"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { browserApi } from "@/lib/api/browser";
import {
  apiErrorCode,
  archiveAccount,
  getAccount,
  unarchiveAccount,
  type AccountWithBalance,
} from "@/lib/core/data/accounts";
import type { ApiClient } from "@/lib/core/data/api-client";
import { isUnauthorized } from "@/lib/core/data/errors";
import { spaceQueryKey } from "@/lib/core/data/spaces";
import { describeApiError, type ErrorDescription } from "@/lib/core/i18n";

type UseArchiveAccountOptions = {
  spaceId: string;
  /** Called once the account is archived (the toast is already shown): leave the form. */
  onArchived: (account: AccountWithBalance) => void;
  api?: ApiClient;
};

/**
 * "Archivar cuenta" (docs/diseno.md D18): `POST .../archive` with no confirmation.
 *
 * - Archived: invalidates the queries of the space, shows "Archivaste «…»" with **Deshacer** (D8) and
 *   calls `onArchived`. "Deshacer" unarchives (`POST .../unarchive`), invalidates and refreshes the
 *   server data; it is a closure over the client and the router, so it works after the form that
 *   archived is gone (the toast outlives it).
 * - 409 `account_has_balance`: the balance is not zero. The account is read again (the balance in
 *   the form may be old) and `blocked` holds it, with `blockedOpen`, for the alert "No se puede
 *   archivar". Dismissing the alert keeps `blocked` so its content stays while it fades out.
 * - Any other failure: `error`, in Spanish (a 401 goes to `/login`).
 */
export function useArchiveAccount({
  spaceId,
  onArchived,
  api = browserApi,
}: UseArchiveAccountOptions) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [blocked, setBlocked] = useState<AccountWithBalance | null>(null);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [error, setError] = useState<ErrorDescription | null>(null);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: spaceQueryKey(spaceId) });
  }

  function undo(account: AccountWithBalance) {
    unarchiveAccount(api, spaceId, account.id)
      .then(() => {
        refresh();
        router.refresh();
      })
      .catch((failure: unknown) => {
        if (isUnauthorized(failure)) {
          window.location.replace("/login");
          return;
        }
        const { title, message } = describeApiError(failure);
        toast.error(title, { description: message });
      });
  }

  const mutation = useMutation({
    mutationFn: (account: AccountWithBalance) => archiveAccount(api, spaceId, account.id),
    onSuccess: (archived) => {
      refresh();
      toast.success(`Archivaste «${archived.name}»`, {
        action: { label: "Deshacer", onClick: () => undo(archived) },
      });
      onArchived(archived);
    },
    onError: async (failure, account) => {
      if (isUnauthorized(failure)) {
        window.location.replace("/login");
        return;
      }
      if (apiErrorCode(failure) === "account_has_balance") {
        // The balance on screen may be old: the alert says what the backend sees now.
        const fresh = await getAccount(api, spaceId, account.id).catch(() => account);
        setBlocked(fresh);
        setBlockedOpen(true);
        return;
      }
      setError(describeApiError(failure));
    },
  });

  return {
    archive: (account: AccountWithBalance) => {
      setError(null);
      mutation.mutate(account);
    },
    busy: mutation.isPending || mutation.isSuccess,
    paused: mutation.isPaused,
    error,
    blocked,
    blockedOpen,
    dismissBlocked: () => setBlockedOpen(false),
  };
}

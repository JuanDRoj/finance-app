"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { browserApi } from "@/lib/api/browser";
import type { ApiClient } from "@/lib/core/data/api-client";
import {
  archiveCategory,
  categoriesRootKey,
  unarchiveCategory,
  type CategoryRead,
} from "@/lib/core/data/categories";
import { isUnauthorized } from "@/lib/core/data/errors";
import { describeApiError, type ErrorDescription } from "@/lib/core/i18n";
import { truncateLabel } from "@/lib/core/movement-label";

type UseArchiveCategoryOptions = {
  spaceId: string;
  /** Called once the category is archived (the toast is already shown): leave the form. */
  onArchived: (category: CategoryRead) => void;
  api?: ApiClient;
};

/**
 * "Archivar categoría" (docs/diseno.md D19): `POST .../archive` with no confirmation.
 *
 * - Archived: invalidates the categories of the space (so the sheet of "Registrar movimiento" stops
 *   offering it), shows "Archivaste «…»" with **Deshacer** (D8) and calls `onArchived`. A principal
 *   category takes its active subcategories with it, which the backend does; "Deshacer" unarchives it
 *   (`POST .../unarchive`) and the backend brings those subcategories back too. The undo is a closure
 *   over the client and the router, so it works after the form that archived is gone (the toast
 *   outlives it). The old movements keep their category: nothing else is invalidated.
 * - Any failure: `error`, in Spanish (a 401 goes to `/login`).
 */
export function useArchiveCategory({
  spaceId,
  onArchived,
  api = browserApi,
}: UseArchiveCategoryOptions) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [error, setError] = useState<ErrorDescription | null>(null);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: categoriesRootKey(spaceId) });
  }

  function undo(category: CategoryRead) {
    unarchiveCategory(api, spaceId, category.id)
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
    mutationFn: (category: CategoryRead) => archiveCategory(api, spaceId, category.id),
    onSuccess: (archived) => {
      refresh();
      toast.success(`Archivaste «${truncateLabel(archived.name)}»`, {
        action: { label: "Deshacer", onClick: () => undo(archived) },
      });
      onArchived(archived);
    },
    onError: (failure) => {
      if (isUnauthorized(failure)) {
        window.location.replace("/login");
        return;
      }
      setError(describeApiError(failure));
    },
  });

  return {
    archive: (category: CategoryRead) => {
      setError(null);
      mutation.mutate(category);
    },
    busy: mutation.isPending || mutation.isSuccess,
    paused: mutation.isPaused,
    error,
  };
}

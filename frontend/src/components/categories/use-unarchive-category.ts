"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { toast } from "sonner";
import { browserApi } from "@/lib/api/browser";
import type { ApiClient } from "@/lib/core/data/api-client";
import {
  categoriesRootKey,
  unarchiveCategory,
  type CategoryRead,
} from "@/lib/core/data/categories";
import { isUnauthorized } from "@/lib/core/data/errors";
import { describeApiError } from "@/lib/core/i18n";
import { truncateLabel } from "@/lib/core/movement-label";

/**
 * "Desarchivar" in the list "Archivadas (n)" of Categorías (docs/diseno.md D19): `POST .../unarchive`
 * with no confirmation. The row leaves the list and the category joins its place (a principal brings
 * back the subcategories archived with it, which the backend does). It invalidates the categories of
 * the space (so the sheet of "Registrar movimiento" offers it again), says "Desarchivaste «…»"
 * **without** "Deshacer" (as Cuentas does: archiving again is one tap on the row), and refreshes the
 * server data.
 *
 * One at a time, even for a quick double tap: a `ref` is set before `mutate` (what `busyId` says comes
 * from the render before) and released when the request settles, success or failure, because the row
 * stays on screen until the new list arrives. A failure is a toast in Spanish (a 401 goes to
 * `/login`); without a connection the request waits (`paused`) and the screen says so.
 */
export function useUnarchiveCategory({
  spaceId,
  api = browserApi,
}: {
  spaceId: string;
  api?: ApiClient;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const running = useRef(false);

  const mutation = useMutation({
    mutationFn: (category: CategoryRead) => unarchiveCategory(api, spaceId, category.id),
    onSuccess: async (category) => {
      toast.success(`Desarchivaste «${truncateLabel(category.name)}»`);
      await queryClient.invalidateQueries({ queryKey: categoriesRootKey(spaceId) });
      router.refresh();
    },
    onError: (error) => {
      if (isUnauthorized(error)) {
        window.location.replace("/login");
        return;
      }
      const { title, message } = describeApiError(error);
      toast.error(title, { description: message });
    },
    onSettled: () => {
      running.current = false;
    },
  });

  return {
    unarchive: (category: CategoryRead) => {
      if (running.current) return;
      running.current = true;
      mutation.mutate(category);
    },
    /** The category being unarchived now (its button shows the spinner; the others wait). */
    busyId: mutation.isPending ? mutation.variables?.id : undefined,
    /** The request is waiting for the connection. */
    paused: mutation.isPaused,
  };
}

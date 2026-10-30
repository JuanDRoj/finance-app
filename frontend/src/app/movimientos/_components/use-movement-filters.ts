"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import {
  applyMovementFilters,
  mergeMovementFilters,
  parseMovementFilters,
  type MovementFilters,
  type MovementFiltersPatch,
} from "@/lib/core/movements";

/**
 * The filters of Movimientos, which live in the URL (docs/diseno.md D2, D19): `?mes=…&tipo=…&q=…&cuenta_id=…&categoria_id=…`.
 * They are read with `useSearchParams` and written with `history.replaceState`, like `?sel` in Cuentas
 * and `?tipo` in Categorías: Next.js sees the write, so whoever reads the URL renders again with no
 * request to the server and no new entry in the history ("atrás" leaves the screen, it does not
 * walk back through months; the rule of FE-32).
 *
 * `currentMonth` is the current month of the space's zone, computed by the server page: the month
 * that `/movimientos` alone means, and the one that is not written to the URL.
 *
 * - `filters` is a stable object while the URL does not change.
 * - `setFilters(patch)` changes some filters (a key with `undefined` takes that filter off). It
 *   reads the address bar **at the moment of the call**, not the render, so two changes in a row
 *   (a chip and then a month) never undo each other, and it keeps every param that is not a filter
 *   (`?movimiento=nuevo`, `?sel=…`).
 * - `clearFilters()` is "Quitar filtros": the type, the search, the account and the category go,
 *   the month stays.
 */
export function useMovementFilters(currentMonth: string): {
  filters: MovementFilters;
  setFilters: (patch: MovementFiltersPatch) => void;
  clearFilters: () => void;
} {
  const search = useSearchParams().toString();
  const filters = useMemo(
    () => parseMovementFilters(new URLSearchParams(search), currentMonth),
    [search, currentMonth],
  );

  const setFilters = useCallback(
    (patch: MovementFiltersPatch) => {
      const url = new URL(window.location.href);
      const merged = mergeMovementFilters(
        parseMovementFilters(url.searchParams, currentMonth),
        patch,
      );
      const next = applyMovementFilters(url.searchParams, merged, currentMonth).toString();
      window.history.replaceState(null, "", `${url.pathname}${next ? `?${next}` : ""}${url.hash}`);
    },
    [currentMonth],
  );

  const clearFilters = useCallback(
    () =>
      setFilters({ type: undefined, q: undefined, accountId: undefined, categoryId: undefined }),
    [setFilters],
  );

  return { filters, setFilters, clearFilters };
}

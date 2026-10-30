"use client";

import { useMemo, useState, type RefObject } from "react";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import type { CategoryRead } from "@/lib/core/data/categories";
import { buildAccountOptions, buildCategoryOptions } from "@/lib/core/movements";
import type { MovementFilters, MovementFiltersPatch } from "@/lib/core/movements";
import { AccountOptionElements, CategoryOptionElements } from "./filter-options";

type FilterSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The account and the category that the URL says: where the draft starts each time the sheet opens. */
  filters: Pick<MovementFilters, "accountId" | "categoryId">;
  accounts: readonly AccountWithBalance[] | undefined;
  /** The accounts did not load: the select is off (unless an account is chosen, which can be taken off). */
  accountsFailed?: boolean;
  categories: readonly CategoryRead[] | undefined;
  categoriesFailed?: boolean;
  /** "Ver movimientos": the account and the category that were chosen. */
  onApply: (patch: MovementFiltersPatch) => void;
  /** "Quitar filtros": the type, the search, the account and the category go; the month stays. */
  onClear: () => void;
  /** Where the focus goes back to: the "Filtrar" button (Safari does not focus a button when it is tapped). */
  finalFocus?: RefObject<HTMLElement | null>;
};

const CATEGORY_HELP = "Una categoría principal incluye sus subcategorías.";

/**
 * "Filtrar movimientos", the bottom sheet of a phone (docs/diseno.md D19; "H1 · Filtrar movimientos"):
 * "Cuenta" and "Categoría" as native selects of 48 px (the system's list, 16 px text), the help
 * "Una categoría principal incluye sus subcategorías." and, at the foot, "Quitar filtros" and "Ver
 * movimientos". The type and the search are not here: they have their own control on the screen.
 *
 * - **A draft.** What is chosen here is local until "Ver movimientos", which writes the account and the
 *   category to the URL in one go and closes. Closing any other way (Cerrar, Escape, the veil)
 *   throws the draft away. The draft starts again from the URL every time the sheet opens.
 * - **"Quitar filtros"** clears everything but the month, as the one in the empty state does, and closes.
 * - **It lives in local state, not in the URL** (the rule of "atrás": a sheet is closed with its own
 *   controls, the back button leaves the screen). The screen loads it with `next/dynamic` on the first tap.
 * - A list that did not load turns its select off and says so, so a failed request is never taken for
 *   "you have no accounts".
 */
export function FilterSheet({
  open,
  onOpenChange,
  filters,
  accounts,
  accountsFailed,
  categories,
  categoriesFailed,
  onApply,
  onClear,
  finalFocus,
}: FilterSheetProps) {
  const [draft, setDraft] = useState({
    account: filters.accountId ?? "",
    category: filters.categoryId ?? "",
  });
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    // A sheet that opens again starts from what the URL says now, not from what was left in it.
    if (open) {
      setDraft({ account: filters.accountId ?? "", category: filters.categoryId ?? "" });
    }
  }

  // The extra choices come from the URL, not from the draft: taking an unknown account off must not make it vanish from the list.
  const accountOptions = useMemo(
    () => buildAccountOptions(accounts, filters.accountId),
    [accounts, filters.accountId],
  );
  const categoryOptions = useMemo(
    () => buildCategoryOptions(categories, filters.categoryId),
    [categories, filters.categoryId],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        // The foot has its own buttons; no "Cancelar" under them.
        closeLabel={null}
        finalFocus={finalFocus}
        className="md:mx-auto md:max-w-160"
      >
        <SheetHeader>
          <SheetTitle>Filtrar movimientos</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <SelectField
            label="Cuenta"
            value={draft.account}
            onChange={(event) => setDraft((d) => ({ ...d, account: event.target.value }))}
            disabled={accountsFailed && !filters.accountId}
            description={accountsFailed ? "No se pudieron cargar tus cuentas." : undefined}
          >
            <AccountOptionElements options={accountOptions} />
          </SelectField>
          <SelectField
            label="Categoría"
            value={draft.category}
            onChange={(event) => setDraft((d) => ({ ...d, category: event.target.value }))}
            disabled={categoriesFailed && !filters.categoryId}
            description={categoriesFailed ? "No se pudieron cargar tus categorías." : CATEGORY_HELP}
          >
            <CategoryOptionElements options={categoryOptions} />
          </SelectField>
        </SheetBody>
        <SheetFooter className="flex-nowrap justify-stretch border-t border-border pt-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onClear();
              onOpenChange(false);
            }}
          >
            Quitar filtros
          </Button>
          <Button
            type="button"
            className="flex-1"
            onClick={() => {
              onApply({
                accountId: draft.account || undefined,
                categoryId: draft.category || undefined,
              });
              onOpenChange(false);
            }}
          >
            Ver movimientos
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

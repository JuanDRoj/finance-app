"use client";

import { useMemo } from "react";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import type { CategoryRead } from "@/lib/core/data/categories";
import {
  buildAccountOptions,
  buildCategoryOptions,
  type MovementFilters,
  type MovementFiltersPatch,
} from "@/lib/core/movements";
import { cn } from "@/lib/utils";
import { AccountOptionElements, CategoryOptionElements } from "./filter-options";
import { FilterSelect } from "./filter-select";
import { MonthSelect } from "./month-select";
import { SearchBox } from "./search-box";
import { TypeChips } from "./type-chips";

/**
 * The filters card of desktop (K-V2-Escritorio, "movimientos"; from 1024 px, the screen hides it
 * below): a solid `surface` card of radius 20 with one row of controls, 10 px apart, in the order of the
 * canvas: the search by description (it takes the room that is left, at least 240 px), the month,
 * the account, the category and the type. The row wraps when the window is short: at 1024 px (about
 * 720 px of content) the chips go to a second row; from 1280 px it fits in one.
 *
 * The account and category selects are 42 px pills (44 and 16 px of text for a finger) with no visible
 * label, named "Cuenta" and "Categoría". The category list is grouped in Gastos, Ingresos and
 * Archivadas on desktop too (the canvas draws it flat there; the groups tell apart a "Regalos" of
 * each kind). A list that did not load turns its select off; the one that is chosen stays on, so it can be taken off.
 */
export function MovementFiltersCard({
  filters,
  currentMonth,
  accounts,
  accountsFailed,
  categories,
  categoriesFailed,
  onChange,
  className,
}: Readonly<{
  filters: MovementFilters;
  currentMonth: string;
  accounts: readonly AccountWithBalance[] | undefined;
  accountsFailed?: boolean;
  categories: readonly CategoryRead[] | undefined;
  categoriesFailed?: boolean;
  onChange: (patch: MovementFiltersPatch) => void;
  className?: string;
}>) {
  const accountOptions = useMemo(
    () => buildAccountOptions(accounts, filters.accountId),
    [accounts, filters.accountId],
  );
  const categoryOptions = useMemo(
    () => buildCategoryOptions(categories, filters.categoryId),
    [categories, filters.categoryId],
  );
  return (
    <section
      aria-label="Filtros"
      data-slot="movement-filters"
      className={cn(
        "flex flex-wrap items-center gap-2.5 rounded-card border border-border bg-surface px-4 py-3.5",
        className,
      )}
    >
      <SearchBox variant="desktop" value={filters.q} onCommit={(q) => onChange({ q })} />
      <MonthSelect
        month={filters.month}
        currentMonth={currentMonth}
        onMonthChange={(month) => onChange({ month })}
      />
      <FilterSelect
        label="Cuenta"
        value={filters.accountId ?? ""}
        onValueChange={(value) => onChange({ accountId: value || undefined })}
        disabled={accountsFailed && !filters.accountId}
        title={accountsFailed ? "No se pudieron cargar tus cuentas" : undefined}
      >
        <AccountOptionElements options={accountOptions} />
      </FilterSelect>
      <FilterSelect
        label="Categoría"
        value={filters.categoryId ?? ""}
        onValueChange={(value) => onChange({ categoryId: value || undefined })}
        disabled={categoriesFailed && !filters.categoryId}
        title={categoriesFailed ? "No se pudieron cargar tus categorías" : undefined}
      >
        <CategoryOptionElements options={categoryOptions} />
      </FilterSelect>
      <TypeChips type={filters.type} onTypeChange={(type) => onChange({ type })} />
    </section>
  );
}

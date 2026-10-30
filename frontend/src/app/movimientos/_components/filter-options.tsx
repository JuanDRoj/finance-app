import type { CategoryFilterOptions, FilterOption } from "@/lib/core/movements";

/** The `<option>`s of the account filter: "Todas las cuentas" first, then `buildAccountOptions`. */
export function AccountOptionElements({ options }: Readonly<{ options: readonly FilterOption[] }>) {
  return (
    <>
      <option value="">Todas las cuentas</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </>
  );
}

/**
 * The `<option>`s of the category filter: "Todas las categorías", the groups Gastos, Ingresos and
 * Archivadas, and at the end the one extra choice when the URL names a category that is not in
 * them (`buildCategoryOptions`). Desktop and the sheet of a phone draw the same list.
 */
export function CategoryOptionElements({ options }: Readonly<{ options: CategoryFilterOptions }>) {
  return (
    <>
      <option value="">Todas las categorías</option>
      {options.groups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </optgroup>
      ))}
      {options.extra ? <option value={options.extra.value}>{options.extra.label}</option> : null}
    </>
  );
}

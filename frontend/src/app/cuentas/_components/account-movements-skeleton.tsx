import { Skeleton } from "@/components/ui/skeleton";

/**
 * The loading state of the table of an account's movements (K-V2-Escritorio, "cuentas"): eight rows of
 * 48 px with a block per column, between the same lines the table has. A `status` with `aria-busy`.
 * The header of the section (the month and "Filtrar") is on screen from the start.
 */
export function AccountMovementsSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Cargando movimientos de la cuenta"
      className="flex flex-col divide-y divide-border border-t border-border"
    >
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="flex h-12 items-center gap-6">
          <Skeleton className="h-3 w-12 rounded-full" />
          <Skeleton className="h-3 max-w-60 flex-1 rounded-full" />
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-3 w-20 rounded-full" />
          <Skeleton className="h-3 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

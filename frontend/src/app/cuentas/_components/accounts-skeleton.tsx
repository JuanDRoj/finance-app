import { Skeleton } from "@/components/ui/skeleton";

const ROWS = [
  { name: "w-[55%]", meta: "w-[30%]" },
  { name: "w-[70%]", meta: "w-[25%]" },
  { name: "w-[45%]", meta: "w-[35%]" },
];

/** The loading state of Cuentas (K-H1-Cuentas "cargando"): a group of three rows that mimics the list. */
export function AccountsSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Cargando cuentas"
      role="status"
      className="flex flex-col gap-2 lg:max-w-100"
    >
      <div className="flex justify-between px-1 py-1.5">
        <Skeleton className="h-3.5 w-24 rounded-full" />
        <Skeleton className="h-3.5 w-22 rounded-full" />
      </div>
      <div className="tile-surface flex flex-col rounded-tile lg:rounded-card">
        {ROWS.map((row, index) => (
          <div key={index} className="flex min-h-17 items-center gap-3 px-3.5 lg:min-h-13.5">
            <Skeleton className="size-10.5 shrink-0 rounded-icon" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className={`h-3 rounded-full ${row.name}`} />
              <Skeleton className={`h-2.5 rounded-full ${row.meta}`} />
            </div>
            <Skeleton className="h-3 w-19 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

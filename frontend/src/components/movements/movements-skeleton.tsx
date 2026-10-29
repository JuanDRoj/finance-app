import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const ROW_WIDTHS = [
  { title: "w-[55%]", line: "w-[35%]" },
  { title: "w-[70%]", line: "w-[30%]" },
  { title: "w-[45%]", line: "w-[40%]" },
  { title: "w-[60%]", line: "w-[25%]" },
];

/**
 * The loading state of Movimientos (K-H1-Movimientos "cargando"): on a phone a block for the
 * summary, the title of a day and a glass card with four rows; from 1024 px three blocks for the
 * figures and a card of table rows. One markup, each part hidden by CSS where it does not belong
 * (the filters are not part of it: the screen draws them from the start). A `status` with
 * `aria-busy`, named "Cargando movimientos".
 */
export function MovementsSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Cargando movimientos"
      className="flex flex-col gap-2.5 lg:gap-3.5"
    >
      <div className="card-surface h-23 rounded-tile lg:hidden" />
      <div className="hidden gap-3.5 lg:flex">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-20 flex-1 basis-50 rounded-card" />
        ))}
      </div>

      <div className="flex flex-col gap-2 lg:hidden">
        <Skeleton className="mx-1 mt-2 h-3 w-37.5 rounded-full" />
        <div className="card-surface divide-y divide-border overflow-hidden rounded-tile">
          {ROW_WIDTHS.map((widths, index) => (
            <div key={index} className="flex min-h-16 items-center gap-3 px-3.5">
              <Skeleton className="size-10 shrink-0 rounded-icon" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className={cn("h-3 rounded-full", widths.title)} />
                <Skeleton className={cn("h-2.5 rounded-full", widths.line)} />
              </div>
              <Skeleton className="h-3 w-18 rounded-full" />
            </div>
          ))}
        </div>
      </div>

      <div className="hidden divide-y divide-border rounded-card border border-border bg-surface px-5.5 py-2.5 lg:block">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="flex h-12 items-center gap-6">
            <Skeleton className="h-3 w-14 rounded-full" />
            <Skeleton className="h-3 max-w-60 flex-1 rounded-full" />
            <Skeleton className="h-5 w-32 rounded-full" />
            <Skeleton className="h-3 w-24 rounded-full" />
            <Skeleton className="h-3 w-24 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

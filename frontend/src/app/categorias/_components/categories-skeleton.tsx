import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const NAME_WIDTHS = ["w-[45%]", "w-[60%]", "w-[35%]"];
const SUB_WIDTHS = ["w-[40%]", "w-[30%]", "w-[45%]"];

/** One principal with one subcategory, as the real list draws it (a glass card on a phone, rows on desktop). */
function SkeletonBranch({ index }: Readonly<{ index: number }>) {
  return (
    <div className="flex flex-col gap-4 px-3.5 py-3 max-lg:card-surface max-lg:rounded-tile lg:gap-3 lg:px-1.5 lg:py-2 lg:not-first:border-t lg:not-first:border-border">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10.5 shrink-0 rounded-icon lg:size-9" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className={cn("h-3 rounded-full", NAME_WIDTHS[index % NAME_WIDTHS.length])} />
          <Skeleton className="h-2.5 w-[30%] rounded-full" />
        </div>
      </div>
      <div className="flex items-center gap-3 pl-5 lg:pl-9">
        <Skeleton className="size-8 shrink-0 rounded-icon lg:size-7" />
        <Skeleton className={cn("h-3 rounded-full", SUB_WIDTHS[index % SUB_WIDTHS.length])} />
      </div>
    </div>
  );
}

function SkeletonCard({ className }: Readonly<{ className?: string }>) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3.5 lg:gap-0 lg:rounded-card lg:border lg:border-border lg:bg-surface lg:p-5",
        className,
      )}
    >
      <div className="hidden items-baseline justify-between gap-3 px-1 pb-2 lg:flex">
        <Skeleton className="h-4.5 w-20 rounded-full" />
        <Skeleton className="h-3.5 w-40 rounded-full" />
      </div>
      {[0, 1, 2].map((index) => (
        <SkeletonBranch key={index} index={index} />
      ))}
    </div>
  );
}

/**
 * The loading state of Categorías (K-H1-Categorias "cargando"): three cards of a principal and a
 * subcategory on a phone, with the segmented control above; from 1024 px two cards (Gastos and
 * Ingresos) with the same rows inside. A `status` with `aria-busy`, named "Cargando categorías".
 */
export function CategoriesSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Cargando categorías"
      className="flex flex-col gap-3.5 lg:flex-row lg:flex-wrap lg:items-start lg:gap-4.5"
    >
      <Skeleton className="h-13 w-full rounded-full lg:hidden" />
      <SkeletonCard className="lg:basis-130 lg:grow-3" />
      <SkeletonCard className="max-lg:hidden lg:basis-90 lg:grow-2" />
    </div>
  );
}

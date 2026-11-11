import { cn } from "@/lib/utils";

/**
 * The "Categoría" chip of a table of movements (K-V2-Escritorio: padding 3 × 10, fully round, 13 px in
 * bold): `primary-soft` for a category, neutral and quiet for a transfer, an adjustment or a movement
 * with none. It is cut with "…" at 224 px and the whole text is in `title`. `category` comes from
 * `describeMovementCategory`. The table of Movimientos and the one of the detail of an account share it.
 */
export function CategoryChip({
  category,
  className,
}: Readonly<{ category: { label: string; quiet: boolean }; className?: string }>) {
  return (
    <span
      title={category.label}
      className={cn(
        "inline-block max-w-56 truncate rounded-full px-2.5 py-0.5 align-middle text-caption font-bold",
        category.quiet
          ? "bg-foreground/6 text-muted-foreground"
          : "bg-primary-soft text-secondary-foreground",
        className,
      )}
    >
      {category.label}
    </span>
  );
}

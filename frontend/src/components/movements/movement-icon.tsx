import { ArrowsLeftRight, Scales } from "@phosphor-icons/react/ssr";
import { CategoryIcon } from "@/components/category-icon";
import type { MovementListItem } from "@/lib/core/data/transactions";
import { isQuietMovement } from "@/lib/core/movements";
import { cn } from "@/lib/utils";

/**
 * The tile of a row of Movimientos on a phone (docs/diseno.md D19; K-H1-Movimientos): 40 px with
 * the icon of the category (the subcategory's own, when it has one), or `arrows-left-right` for a
 * transfer and `scales` for an adjustment. A transfer and an adjustment go on a neutral tile, not
 * on the green of the categories. Decorative: the row says the same in words. The canvas rounds the
 * tile at 14 px; the nearest token is `rounded-icon` (16 px), as in Categorías.
 */
export function MovementIcon({
  item,
  className,
}: Readonly<{ item: Pick<MovementListItem, "type" | "category">; className?: string }>) {
  const quiet = isQuietMovement(item);
  return (
    <span
      aria-hidden
      data-slot="movement-icon"
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-icon",
        quiet ? "bg-foreground/6 text-muted-foreground" : "bg-secondary text-primary",
        className,
      )}
    >
      {item.type === "transfer" ? (
        <ArrowsLeftRight className="size-5" />
      ) : item.type === "adjustment" ? (
        <Scales className="size-5" />
      ) : (
        <CategoryIcon icon={item.category?.icon ?? "tag"} className="size-5" />
      )}
    </span>
  );
}

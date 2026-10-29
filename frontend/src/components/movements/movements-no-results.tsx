import { MagnifyingGlass } from "@phosphor-icons/react/ssr";
import { useId } from "react";
import { Button } from "@/components/ui/button";

/**
 * The list is empty for the month and the filters it has (K-H1-Movimientos "sin resultados" and
 * the empty table of K-V2-Escritorio; docs/diseno.md D19): "No hay movimientos con estos filtros".
 * It is not "Aún no tienes movimientos" (`MovementsEmpty`), which is for a space with none at all.
 *
 * - **Phone:** a glass card with an icon, the title, "Prueba con otro mes, otra búsqueda u otros
 *   filtros." and the button.
 * - **Desktop:** it goes inside the card of the table, so it is just the title and the button (no
 *   icon, no card, no explanation), as the canvas draws it.
 *
 * `onClearFilters` is "Quitar filtros". The screen gives it only when there is something to clear
 * besides the month (the month has its own control): without it there is no button.
 */
export function MovementsNoResults({ onClearFilters }: Readonly<{ onClearFilters?: () => void }>) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      data-slot="movements-no-results"
      className="flex flex-col items-center gap-3 px-5.5 py-7 text-center max-lg:card-surface max-lg:rounded-tile lg:gap-2.5 lg:px-0 lg:py-8"
    >
      <span
        aria-hidden
        className="flex size-16 items-center justify-center rounded-xl bg-secondary text-primary lg:hidden"
      >
        <MagnifyingGlass className="size-7.5" />
      </span>
      <h2 id={titleId} className="font-heading text-xl font-bold text-balance lg:text-base">
        No hay movimientos con estos filtros
      </h2>
      <p className="max-w-sm text-item text-pretty text-muted-foreground lg:hidden">
        Prueba con otro mes, otra búsqueda u otros filtros.
      </p>
      {onClearFilters ? (
        <Button
          variant="outline"
          size="sm"
          onClick={onClearFilters}
          className="mt-1 min-h-12 px-5.5 text-item lg:mt-0 lg:min-h-10 lg:px-4 lg:text-sm lg:pointer-coarse:min-h-11"
        >
          Quitar filtros
        </Button>
      ) : null}
    </section>
  );
}

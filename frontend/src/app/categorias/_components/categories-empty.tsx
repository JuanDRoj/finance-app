import { Plus } from "@phosphor-icons/react/ssr";
import Image from "next/image";
import { CATEGORY_PANEL } from "@/components/accounts/panel-url";
import { newCategoryPageHref } from "@/components/categories/category-urls";
import { PrimaryActionLink } from "@/components/primary-action-link";
import { buttonVariants } from "@/components/ui/button-variants";
import { categoryKindParam } from "@/lib/core/categories";
import type { CategoryKind } from "@/lib/core/data/categories";
import { describeCategoryKind } from "@/lib/core/i18n";

/**
 * A kind with no active category (K-H1-Categorias "vacío"): the grillo, "No tienes categorías de
 * gasto activas", what to do and "Crear categoría", which opens the form with that kind chosen (a
 * page below 1024 px, the side panel from there). With archived ones, they are below, so they can be
 * unarchived. On a phone it is a glass card; inside the card of the kind on desktop it is just the
 * block, not a card in a card.
 */
export function CategoriesEmpty({ kind }: Readonly<{ kind: CategoryKind }>) {
  return (
    <div className="flex flex-col items-center gap-3 px-5.5 py-7 text-center max-lg:card-surface max-lg:rounded-tile">
      <Image
        src="/brand/kanza-symbol.svg"
        alt=""
        width={120}
        height={120}
        className="size-30 shrink-0"
      />
      <h3 className="font-heading text-xl font-bold text-balance">
        No tienes categorías de {describeCategoryKind(kind).toLowerCase()} activas
      </h3>
      <p className="max-w-sm text-item text-pretty text-muted-foreground">
        Crea una o desarchiva alguna de las que guardaste.
      </p>
      <PrimaryActionLink
        href={newCategoryPageHref({ kind })}
        panel={{ ...CATEGORY_PANEL, extra: { tipo: categoryKindParam(kind) } }}
        className={buttonVariants({ size: "default", className: "mt-2" })}
      >
        <Plus aria-hidden weight="bold" className="size-4.5" />
        Crear categoría
      </PrimaryActionLink>
    </div>
  );
}

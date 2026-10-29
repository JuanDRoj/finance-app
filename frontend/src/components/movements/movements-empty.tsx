import { Plus } from "@phosphor-icons/react/ssr";
import Image from "next/image";
import { PRIMARY_ACTION, type PrimaryAction } from "@/components/nav-sections";
import { PrimaryActionLink } from "@/components/primary-action-link";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";

/**
 * Movimientos when the space has none yet (K-H1-MovimientosVacio and K-V2-MovimientosVacio;
 * docs/diseno.md D17 › Escritorio v2, D19): the grillo, "Aún no tienes movimientos", what to do and a
 * button that opens "Registrar movimiento". A glass card, centered, on a phone; from 1024 px a card
 * of up to 720 px with the grillo (140 px) on the left of a left-aligned text, wrapping under it
 * if the width is short, as the Inicio sin cuentas.
 *
 * `action` is what the button does: `PRIMARY_ACTION` by default, and `NEW_ACCOUNT_ACTION` when the
 * page knows there is no active account (nothing can be registered yet); its `label` is the text of
 * the button. This is not the state of "this month has none" nor of filters that match nothing:
 * that is `MovementsNoResults`; this one is for a space that has never had a movement.
 */
export function MovementsEmpty({
  action = PRIMARY_ACTION,
}: Readonly<{ action?: PrimaryAction | null }>) {
  return (
    <Card
      variant="tile"
      className="items-center gap-3 px-5.5 py-7 text-center lg:max-w-180 lg:flex-row lg:flex-wrap lg:gap-7 lg:p-8 lg:text-left"
    >
      {/* Decorative: the title next to it already says what happens. */}
      <Image
        src="/brand/kanza-symbol.svg"
        alt=""
        width={140}
        height={140}
        className="size-30 shrink-0 lg:size-35"
      />
      <div className="flex min-w-0 flex-col items-center gap-3 lg:flex-1 lg:basis-70 lg:items-start">
        <h2 className="font-heading text-xl font-bold text-balance lg:text-2xl lg:tracking-title">
          Aún no tienes movimientos
        </h2>
        <p className="text-item text-pretty text-muted-foreground lg:text-base lg:leading-normal">
          Registra un gasto, un ingreso o una transferencia entre tus cuentas. Puedes empezar por lo
          que gastaste hoy.
        </p>
        {action ? (
          <PrimaryActionLink
            href={action.href}
            panel={action.panel}
            panelOnPhone={action.panelOnPhone}
            className={buttonVariants({ size: "default", className: "mt-2" })}
          >
            <Plus aria-hidden weight="bold" className="size-4.5" />
            {action.label}
          </PrimaryActionLink>
        ) : null}
      </div>
    </Card>
  );
}

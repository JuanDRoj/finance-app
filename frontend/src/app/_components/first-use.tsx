import { Plus } from "@phosphor-icons/react/ssr";
import Image from "next/image";
import { NEW_ACCOUNT_PANEL } from "@/components/accounts/panel-url";
import { PrimaryActionLink } from "@/components/primary-action-link";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";

/**
 * The card of the Inicio when the space has no accounts yet (docs/diseno.md D18 and D16, "Inicio
 * sin cuentas"): the grillo, "Empieza por tus cuentas", what to add and the button that opens the
 * form of the first account. No onboarding: this is the whole invitation.
 *
 * Centered in a column on a phone (the grillo at 120 px) and, from 1024 px, the grillo at 140 px on
 * the left of a left-aligned text, wrapping under it if the width is short. The button is the
 * same link as the sidebar's: a page below 1024 px, the side panel over the Inicio from there.
 * It goes to the form of an account whatever the main action becomes later (FE-20 turns that one
 * into "Registrar"), so it names its destination here instead of reading `PRIMARY_ACTION`.
 */
export function FirstUse() {
  return (
    <Card
      variant="tile"
      className="flex-1 items-center gap-3 px-5.5 py-7 text-center lg:flex-row lg:flex-wrap lg:gap-7 lg:p-8 lg:text-left"
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
          Empieza por tus cuentas
        </h2>
        <p className="text-item text-pretty text-muted-foreground lg:text-base lg:leading-normal">
          Agrega dónde está tu dinero hoy: un banco, tu efectivo o una tarjeta. Con su saldo actual
          verás tu neto al instante.
        </p>
        <PrimaryActionLink
          href="/cuentas/nueva"
          panel={NEW_ACCOUNT_PANEL}
          className={buttonVariants({ size: "default", className: "mt-2" })}
        >
          <Plus aria-hidden weight="bold" className="size-4.5" />
          Crear mi primera cuenta
        </PrimaryActionLink>
      </div>
    </Card>
  );
}

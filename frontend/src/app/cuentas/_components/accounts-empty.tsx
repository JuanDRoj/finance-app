import { Plus } from "@phosphor-icons/react/ssr";
import Image from "next/image";
import { NEW_ACCOUNT_PANEL } from "@/components/accounts/panel-url";
import { PrimaryActionLink } from "@/components/primary-action-link";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";

/**
 * Cuentas without an active account (K-H1-Cuentas "vacío"): the grillo, what to add and "Crear
 * cuenta", which opens the form of an account (a page below 1024 px, the side panel from there). It
 * is also what the detail's place shows on desktop when there is nothing to show. With only archived
 * accounts it sits above their section, so they can still be unarchived.
 */
export function AccountsEmpty() {
  return (
    <Card
      variant="tile"
      role="region"
      aria-labelledby="accounts-empty-title"
      className="items-center gap-3 px-5.5 py-7 text-center"
    >
      <Image
        src="/brand/kanza-symbol.svg"
        alt=""
        width={120}
        height={120}
        className="size-30 shrink-0"
      />
      <h2 id="accounts-empty-title" className="font-heading text-xl font-bold text-balance">
        Aún no tienes cuentas
      </h2>
      <p className="max-w-sm text-item text-pretty text-muted-foreground">
        Agrega un banco, tu efectivo o una tarjeta con su saldo de hoy.
      </p>
      <PrimaryActionLink
        href="/cuentas/nueva"
        panel={NEW_ACCOUNT_PANEL}
        className={buttonVariants({ size: "default", className: "mt-2" })}
      >
        <Plus aria-hidden weight="bold" className="size-4.5" />
        Crear cuenta
      </PrimaryActionLink>
    </Card>
  );
}

import { Plus } from "@phosphor-icons/react/ssr";
import { NEW_ACCOUNT_ACTION, PRIMARY_ACTION } from "@/components/nav-sections";
import { PrimaryActionLink } from "@/components/primary-action-link";
import { focusRing } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/**
 * What goes on the right of the header of Movimientos (docs/diseno.md D17 › Escritorio v2): from 1024
 * px, the pill "Registrar movimiento" (46 px, `primary`), which opens the same panel as the button
 * of the sidebar (the link goes to the main action's page; from 1024 px a click opens the panel over
 * the screen). With no active account it says "Nueva cuenta" and opens that form, as the sidebar and
 * the "+" do (`noAccounts`). Below 1024 px there is nothing here yet: the bottom bar has the "+",
 * and the magnifier that the canvas draws is FE-33's, which will go next to this one.
 */
export function MovementsHeaderActions({ noAccounts }: Readonly<{ noAccounts?: boolean }>) {
  const action = noAccounts ? NEW_ACCOUNT_ACTION : PRIMARY_ACTION;
  if (!action) return null;
  return (
    <PrimaryActionLink
      href={action.href}
      panel={action.panel}
      panelOnPhone={action.panelOnPhone}
      className={cn(
        "hidden h-11.5 items-center gap-2 rounded-full bg-primary px-4.5 text-item font-bold text-primary-foreground lg:inline-flex",
        "transition-[transform,filter] duration-150 ease-out active:scale-[0.97] hover:brightness-95",
        focusRing,
      )}
    >
      <Plus aria-hidden weight="bold" className="size-4.5" />
      {action.label}
    </PrimaryActionLink>
  );
}

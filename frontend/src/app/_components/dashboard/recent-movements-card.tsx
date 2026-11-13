"use client";

import { Plus } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useId } from "react";
import { MovementsTable } from "@/components/movements/movements-table";
import { PRIMARY_ACTION } from "@/components/nav-sections";
import { PrimaryActionLink } from "@/components/primary-action-link";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { focusRing } from "@/components/ui/focus";
import type { MovementListItem } from "@/lib/core/data/transactions";
import type { Currency } from "@/lib/core/money";
import { cn } from "@/lib/utils";
import { InlineError, TableSkeleton } from "./dashboard-states";
import type { Load } from "./use-dashboard-data";

/**
 * "Últimos movimientos", the short table of the Inicio (FE-24, KAN-84; K-V2-Escritorio, docs/diseno.md
 * D17 › Escritorio v2): the six latest movements of the whole history (no month filter), with Fecha,
 * Descripción, Categoría, Cuenta and Monto, and "Ver todos" to Movimientos. It exists from 1024 px only
 * (`max-lg:hidden`; a phone has the Movimientos tab). The description of a row opens the movement over
 * this screen (`MovementLink`, handled by the `MovementPanelHost` of the shell); there is no "Eliminar"
 * here (`variant="compact"`).
 *
 * It does not ask for the six movements below 1024 px (see `useDashboardData`). Failing is "No se
 * pudieron cargar tus últimos movimientos" with "Reintentar", never an empty table.
 */
export function RecentMovementsCard({
  recent,
  currency,
  today,
  className,
}: Readonly<{
  recent: Load<MovementListItem[]>;
  currency: Currency;
  today: string;
  className?: string;
}>) {
  const titleId = useId();
  const items = recent.data;
  return (
    <Card
      variant="tile"
      role="region"
      aria-labelledby={titleId}
      aria-busy={!items && !recent.failed ? true : undefined}
      className={cn("max-lg:hidden lg:gap-2 lg:px-6 lg:py-5.5", className)}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={titleId} className="font-heading text-card-title font-bold">
          Últimos movimientos
        </h2>
        <Link
          href="/movimientos"
          prefetch={false}
          className={cn(
            "inline-flex min-h-9 items-center rounded-sm text-sm font-bold text-primary hover:underline pointer-coarse:min-h-11",
            focusRing,
          )}
        >
          Ver todos
        </Link>
      </div>
      {recent.failed ? (
        <InlineError
          title="No se pudieron cargar tus últimos movimientos"
          error={recent.error}
          onRetry={recent.retry}
          busy={recent.busy}
        />
      ) : !items ? (
        <TableSkeleton />
      ) : items.length === 0 ? (
        <div className="flex flex-col items-start gap-3 py-2">
          <p className="text-item text-muted-foreground">
            Aún no tienes movimientos. Registra un gasto, un ingreso o una transferencia entre tus
            cuentas.
          </p>
          {PRIMARY_ACTION ? (
            <PrimaryActionLink
              href={PRIMARY_ACTION.href}
              panel={PRIMARY_ACTION.panel}
              panelOnPhone={PRIMARY_ACTION.panelOnPhone}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              <Plus aria-hidden weight="bold" />
              Registrar movimiento
            </PrimaryActionLink>
          ) : null}
        </div>
      ) : (
        <MovementsTable
          items={items}
          currency={currency}
          today={today}
          caption="Últimos movimientos"
          variant="compact"
        />
      )}
    </Card>
  );
}

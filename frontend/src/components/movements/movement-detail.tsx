"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { focusRing } from "@/components/ui/focus";
import { SheetBody, SheetFooter } from "@/components/ui/sheet";
import type { MovementRead } from "@/lib/core/data/transactions";
import { describeTransactionStatus, describeTransactionType } from "@/lib/core/i18n";
import type { Currency } from "@/lib/core/money";
import {
  describeMovementAccount,
  describeMovementCategory,
  describeMovementDetailDate,
  movementAmountView,
  type MovementDetailKind,
} from "@/lib/core/movements";
import { cn } from "@/lib/utils";

/**
 * The note of an adjustment (docs/diseno.md D19, text approved by Juan David on 2026-11-03): the
 * canvas still says "elimínalo y vuelve a cuadrar la cuenta", but the API refuses to delete an
 * adjustment (409 `transaction_not_editable`), so the way to correct one is to match the account again.
 */
export const ADJUSTMENT_NOTE =
  "Los ajustes salen de «Cuadrar saldo» y no cuentan como ingreso ni gasto. No se editan: si no corresponde, cuadra la cuenta de nuevo.";

/** Where "Cuadrar saldo" of an account is: `/cuentas` opens its panel from 1024 px and its page below it. */
export function reconcileHref(accountId: string): string {
  return `/cuentas?sel=${encodeURIComponent(accountId)}&cuenta=cuadrar`;
}

type MovementDetailProps = {
  movement: MovementRead;
  /** Why it is read only: an adjustment, a pending or skipped movement, or an archived account (`movementDetailKind`). */
  kind: Exclude<MovementDetailKind, "editable">;
  currency: Currency;
  /** The space's day (`todayInTimezone`): a date of another year is written with its year. */
  today?: string;
  /** The accounts of the movement that are archived (`archivedAccountsOf`), by name. */
  archivedAccounts?: readonly { id: string; name: string }[];
  /**
   * `sheet`: the bottom sheet of a phone, "Cerrar" full width. `panel`: the side panel of desktop,
   * "Cerrar" at the right of the footer.
   */
  variant: "sheet" | "panel";
  /** "Cerrar". */
  onClose: () => void;
};

function Row({
  label,
  children,
  strong = false,
}: Readonly<{ label: string; children: ReactNode; strong?: boolean }>) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-border px-4 py-3.5 first:border-t-0">
      <dt className="shrink-0 text-sm font-bold text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 text-right wrap-anywhere",
          strong ? "font-heading text-xl font-semibold tabular-nums" : "text-item font-bold",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

const NOTE = "rounded-field bg-primary-soft px-3.5 py-3 text-sm leading-snug";
const LINK = cn(
  "inline-flex min-h-11 w-fit items-center rounded-full text-sm font-bold text-primary underline underline-offset-4",
  focusRing,
);

/**
 * A movement in **read only** (docs/diseno.md D19, "Detalle de ajuste"; K-H1-Movimientos `ajuste` and
 * K-V2-Escritorio `ajuste`): what the API does not let change. The body is a card of rows (amount,
 * account, date) and a note that says why; the footer is "Cerrar".
 *
 * - **Adjustment** ("Ajuste de saldo"): amount, account and date, `ADJUSTMENT_NOTE` and a link to
 *   "Cuadrar saldo" of its account (`/cuentas?sel=<id>&cuenta=cuadrar`; left out if that account is
 *   archived, which cannot be matched). There is **no "Eliminar ajuste"**: the API refuses it.
 * - **Pending or skipped:** the same rows plus the category or the two accounts, the description and
 *   the state, and a note: they belong to the recurring flow and are not edited here.
 * - **Archived account:** a confirmed expense, income or transfer that would be a 409 `account_archived`
 *   to edit or delete; the note names the account and links to Cuentas, where "Desarchivar" is.
 *
 * Nothing here changes data. The title of the sheet is the container's (`describeMovementDetailTitle`).
 */
export function MovementDetail({
  movement,
  kind,
  currency,
  today,
  archivedAccounts = [],
  variant,
  onClose,
}: MovementDetailProps) {
  const amount = movementAmountView(movement, currency).text;
  const date = describeMovementDetailDate(movement.date, today);
  const description = movement.description?.trim();
  const adjustment = kind === "adjustment";
  const reconcilable = adjustment && movement.account && archivedAccounts.length === 0;

  let note: ReactNode;
  if (adjustment) {
    note = ADJUSTMENT_NOTE;
  } else if (kind === "unconfirmed") {
    note = `Este movimiento está ${describeTransactionStatus(movement.status).toLowerCase()}. Los movimientos pendientes y omitidos no se pueden editar ni eliminar desde aquí.`;
  } else {
    const names = archivedAccounts.map((account) => `«${account.name}»`).join(" y ");
    note = `Desarchiva ${names || "la cuenta"} desde Cuentas para editar o eliminar este movimiento.`;
  }

  return (
    <>
      <SheetBody data-movement-detail={kind}>
        <dl className="overflow-hidden rounded-card border border-input bg-card-solid">
          <Row label="Monto" strong>
            {amount}
          </Row>
          {adjustment ? null : (
            <>
              <Row label="Tipo">{describeTransactionType(movement.type)}</Row>
              {movement.type === "transfer" ? (
                <>
                  <Row label="Desde">{movement.from_account?.name ?? "Sin cuenta"}</Row>
                  <Row label="Hacia">{movement.to_account?.name ?? "Sin cuenta"}</Row>
                </>
              ) : (
                <Row label="Categoría">{describeMovementCategory(movement).label}</Row>
              )}
            </>
          )}
          {movement.type === "transfer" ? null : (
            <Row label="Cuenta">{describeMovementAccount(movement)}</Row>
          )}
          <Row label="Fecha">{date}</Row>
          {adjustment || !description ? null : <Row label="Descripción">{description}</Row>}
          {movement.status === "confirmed" ? null : (
            <Row label="Estado">{describeTransactionStatus(movement.status)}</Row>
          )}
        </dl>
        <p className={NOTE}>{note}</p>
        {reconcilable && movement.account ? (
          <Link href={reconcileHref(movement.account.id)} prefetch={false} className={LINK}>
            Cuadrar saldo
          </Link>
        ) : null}
        {kind === "archived-account" ? (
          <Link href="/cuentas" prefetch={false} className={LINK}>
            Ir a Cuentas
          </Link>
        ) : null}
      </SheetBody>
      {variant === "panel" ? (
        <SheetFooter>
          <Button type="button" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </SheetFooter>
      ) : (
        <SheetFooter className="flex-nowrap border-t border-border pt-3">
          <Button type="button" variant="outline" onClick={onClose} className="min-w-0 flex-1">
            Cerrar
          </Button>
        </SheetFooter>
      )}
    </>
  );
}

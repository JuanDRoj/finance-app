"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * The summary of the period could not be loaded (docs/diseno.md D19): a short notice in the place of
 * the three figures, with "Reintentar" that asks for the summary again. The list is right without it,
 * so it stays, and its foot says "Mostrando n movimientos" (no "de m") until the summary comes. Same
 * look as the other notices in line (`NextPageError`): the figures never disappear without a word.
 */
export function SummaryError({
  onRetry,
  busy,
  className,
}: Readonly<{ onRetry: () => void; busy: boolean; className?: string }>) {
  return (
    <Alert
      data-slot="summary-error"
      title="No se pudo cargar el resumen"
      className={className}
      action={
        <Button variant="secondary" size="sm" loading={busy} onClick={onRetry}>
          Reintentar
        </Button>
      }
    />
  );
}

"use client";

import { WifiSlash } from "@phosphor-icons/react/ssr";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * The error state of Cuentas (K-H1-Cuentas "error"): the list could not be loaded. It is never
 * taken for "no accounts". Fixed copy, as the canvas writes it; "Reintentar" asks again.
 */
export function AccountsError({ onRetry, busy }: Readonly<{ onRetry: () => void; busy: boolean }>) {
  return (
    <Card variant="tile" role="alert" className="items-center gap-3 px-5.5 py-7 text-center">
      <span
        aria-hidden
        className="flex size-18 items-center justify-center rounded-3xl bg-destructive/10 text-destructive"
      >
        <WifiSlash className="size-9" />
      </span>
      <h2 className="font-heading text-xl font-bold text-balance">
        No se pudieron cargar tus cuentas
      </h2>
      <p className="max-w-sm text-item text-pretty text-muted-foreground">
        Revisa tu conexión e inténtalo de nuevo; tus datos están a salvo.
      </p>
      <Button onClick={onRetry} loading={busy} className="mt-2">
        Reintentar
      </Button>
    </Card>
  );
}

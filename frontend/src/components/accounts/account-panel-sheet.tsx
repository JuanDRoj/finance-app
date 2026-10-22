"use client";

import { AccountForm } from "@/components/accounts/account-form";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { Currency } from "@/lib/core/money";

type AccountPanelSheetProps = {
  /** Whether the panel is showing. It stays mounted while it leaves, so the exit animation plays. */
  open: boolean;
  space: { id: string; currency: Currency };
  /** Called to close it: from "Cancelar", "Cerrar", Escape, the veil and a created account. */
  onClose: () => void;
  /** The API client of the form; the browser's by default (the catalog scripts one). */
  api?: ApiClient;
};

/** The first field of the form: where the focus starts when the panel opens. */
function startOnTheName(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-slot='sheet-content'] input[name='name']");
}

/**
 * The side panel "Nueva cuenta" (docs/diseno.md D17 › Escritorio v2, D18): the `Sheet` on the right
 * with the title, the "Cerrar" button, and the form of a new account (variant `panel`: fields that
 * scroll, "Cancelar · Crear cuenta" below). Modal: the focus is trapped inside, starts on the name,
 * and Escape or the veil close it. Loaded by `AccountPanelHost` only when it is asked for.
 */
export function AccountPanelSheet({ open, space, onClose, api }: AccountPanelSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent side="right" initialFocus={startOnTheName}>
        <SheetHeader>
          <SheetTitle>Nueva cuenta</SheetTitle>
        </SheetHeader>
        <AccountForm variant="panel" space={space} onDone={onClose} onCancel={onClose} api={api} />
      </SheetContent>
    </Sheet>
  );
}

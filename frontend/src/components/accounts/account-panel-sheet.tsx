"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
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
 * Where the focus goes after an account was created: the title of the screen (`h1`, which the shell
 * makes focusable). The button that opened the panel is no place to go back to: the screen changes
 * under it (the "Crear mi primera cuenta" of the Inicio is replaced by "Tus cuentas" once the page
 * is refreshed), and a focus on an element that leaves ends on the `body`.
 */
function titleOfTheScreen(): HTMLElement | null {
  return document.querySelector<HTMLElement>("h1");
}

/**
 * The side panel "Nueva cuenta" (docs/diseno.md D17 › Escritorio v2, D18): the `Sheet` on the right
 * with the title, the "Cerrar" button, and the form of a new account (variant `panel`: fields that
 * scroll, "Cancelar · Crear cuenta" below). Modal: the focus is trapped inside, starts on the name,
 * and Escape or the veil close it. Loaded by `AccountPanelHost` only when it is asked for.
 *
 * When it closes the focus goes back to what opened it, as in any dialog; except after creating an
 * account, when it goes to the title of the screen (see `titleOfTheScreen`). Creating also closes the
 * panel *before* refreshing the page's server data: the refresh then renders the URL without
 * `?cuenta=nueva`, so it cannot bring the panel back.
 */
export function AccountPanelSheet({ open, space, onClose, api }: AccountPanelSheetProps) {
  const router = useRouter();
  const created = useRef(false);

  // Every opening starts as "not created yet".
  useEffect(() => {
    if (open) created.current = false;
  }, [open]);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side="right"
        initialFocus={startOnTheName}
        finalFocus={() => (created.current ? titleOfTheScreen() : true)}
      >
        <SheetHeader>
          <SheetTitle>Nueva cuenta</SheetTitle>
        </SheetHeader>
        <AccountForm
          variant="panel"
          space={space}
          onDone={() => {
            created.current = true;
            onClose();
            router.refresh();
          }}
          onCancel={onClose}
          api={api}
        />
      </SheetContent>
    </Sheet>
  );
}

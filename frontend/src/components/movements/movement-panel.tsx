"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  MOVEMENT_PANEL,
  NEW_ACCOUNT_PANEL,
  closePanelInUrl,
  openPanelInUrl,
  replacePanelInUrl,
} from "@/components/accounts/panel-url";
import { DESKTOP_MEDIA_QUERY } from "@/components/use-is-desktop";
import type { Currency } from "@/lib/core/money";

// The sheet (the form, react-hook-form, zod, the grid of categories) loads when it is asked for, not
// with every screen that has the shell.
const MovementSheet = dynamic(() =>
  import("@/components/movements/movement-sheet").then((module) => module.MovementSheet),
);

/** What a modal leaves in the page: a second sheet must not open over it with a key. */
const MODAL = "[role='dialog'], [role='alertdialog'], [role='menu'], [aria-modal='true']";

/** Inputs that take no text: a key typed on them is not text typed in a field. */
const NON_TEXT_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** Whether typing on this element writes text (so a letter is for the field, not for a shortcut). */
function isTextField(element: EventTarget | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  // `isContentEditable` is the browser's answer; the attribute covers where it is not implemented.
  if (element.isContentEditable) return true;
  const editable = element.closest("[contenteditable]");
  if (editable && editable.getAttribute("contenteditable") !== "false") return true;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  if (element instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(element.type);
  const role = element.getAttribute("role");
  return role === "textbox" || role === "combobox" || role === "searchbox";
}

type MovementPanelHostProps = {
  /** The space the movement is registered in; without it (a screen that could not load it) nothing opens. */
  space?: { id: string; currency: Currency; timezone: string };
  /**
   * The page knows the space has no active account: the key N and a URL that asks for the sheet go
   * to "Nueva cuenta" straight away. Without it the sheet finds out when its accounts load.
   */
  noAccounts?: boolean;
};

/**
 * Where "Registrar movimiento" is shown (docs/diseno.md D17 › Escritorio v2, D19). `AppShell` mounts
 * it on every screen with a session, so the sheet opens over whichever one the person is on. The URL
 * says when, and `useSearchParams` reads it: `?movimiento=nuevo`, which the "+" of the bottom bar and
 * the "Registrar" of the sidebar write (`PrimaryActionLink`, with `history.replaceState`: no request
 * and no history entries, so "atrás" leaves the screen instead of closing the sheet) and which also
 * works as a link. It is the bottom sheet below 1024 px and the side panel from there; closing it
 * takes the param out.
 *
 * - **Without accounts** there is nothing to register on: `?movimiento` is swapped for `?cuenta=nueva`
 *   in one write (`AccountPanelHost` opens the panel on desktop and goes to `/cuentas/nueva` on a
 *   phone). The sheet asks for it when it finds no active account; a page that already knows says so
 *   with `noAccounts`.
 * - **Saved:** the host closes first and refreshes the server data *after* (the Inicio and the neto
 *   of Cuentas come from the server), so the refresh already renders the URL without the param and
 *   cannot bring the sheet back.
 * - **The key N**, from 1024 px, opens it (or "Nueva cuenta" with `noAccounts`) when the focus is not on
 *   a field where a letter is text, no modifier is held and no dialog or menu is open.
 * - It mounts the first time it is asked for and stays mounted (closed) afterwards, so it can play
 *   its exit animation; its form starts afresh every time it opens.
 */
export function MovementPanelHost({ space, noAccounts }: MovementPanelHostProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get(MOVEMENT_PANEL.param) === MOVEMENT_PANEL.value;
  // Another panel (a new account) is asked for too: that one wins and this one stays out of the way.
  const accountPanelAsked = searchParams.has(NEW_ACCOUNT_PANEL.param);
  const open = requested && space !== undefined && !accountPanelAsked;

  // Derived during render, not in an effect: once opened it stays mounted.
  const [mounted, setMounted] = useState(false);
  if (open && !mounted) setMounted(true);

  const close = useCallback(() => closePanelInUrl(MOVEMENT_PANEL.param), []);
  const goToNewAccount = useCallback(
    () => replacePanelInUrl(MOVEMENT_PANEL.param, NEW_ACCOUNT_PANEL),
    [],
  );

  // A link or a URL that asks for the sheet on a space the page knows is empty: "Nueva cuenta".
  useEffect(() => {
    if (open && noAccounts) goToNewAccount();
  }, [open, noAccounts, goToNewAccount]);

  useEffect(() => {
    if (!space) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "n") return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.repeat || event.defaultPrevented || event.isComposing) return;
      if (isTextField(event.target) || isTextField(document.activeElement)) return;
      // The width is asked now, not remembered: the key is for desktop, where the sidebar shows it.
      if (!window.matchMedia(DESKTOP_MEDIA_QUERY).matches) return;
      if (document.querySelector(MODAL)) return;
      event.preventDefault();
      openPanelInUrl(noAccounts ? NEW_ACCOUNT_PANEL : MOVEMENT_PANEL);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [space, noAccounts]);

  if (!space || !mounted) return null;
  return (
    <MovementSheet
      open={open}
      space={space}
      onClose={close}
      onSaved={() => {
        close();
        router.refresh();
      }}
      onNoAccounts={goToNewAccount}
    />
  );
}

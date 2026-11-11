"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  MOVEMENT_PANEL,
  MOVEMENT_PANEL_COMPANIONS,
  NEW_ACCOUNT_PANEL,
  closePanelInUrl,
  openPanelInUrl,
  replacePanelInUrl,
} from "@/components/accounts/panel-url";
import { parseMovementEditId } from "@/components/movements/movement-urls";
import { DESKTOP_MEDIA_QUERY } from "@/components/use-is-desktop";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { Currency } from "@/lib/core/money";

// The sheets (the form, react-hook-form, zod, the grid of categories) load when they are asked for,
// not with every screen that has the shell.
const MovementSheet = dynamic(() =>
  import("@/components/movements/movement-sheet").then((module) => module.MovementSheet),
);
const MovementEditSheet = dynamic(() =>
  import("@/components/movements/movement-edit-sheet").then((module) => module.MovementEditSheet),
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
  /** The API client; the browser's by default. The catalog passes a scripted one. */
  api?: ApiClient;
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
 *
 * **Editing (FE-23, KAN-83).** `?movimiento=editar&id=<uuid>` (a `MovementLink`: a row of the phone's
 * list, the description or the "Editar X" / "Ver X" of the table, written with `history.replaceState`
 * too) opens `MovementEditSheet` on that movement, at every width. An `id` that is not a UUID would be
 * a 422 from the API: the params are taken out of the URL in one write instead. Saving closes first
 * and refreshes the server data after (the Inicio, the page of an account); deleting only closes (the
 * hook that deletes refreshes). Unlike the sheet that registers, this one is **unmounted when it has
 * left** (`onExited`): every opening asks the movement again, and the form starts from what the
 * server says now. `?cuenta=nueva` wins over both, as it always did.
 */
export function MovementPanelHost({ space, noAccounts, api }: MovementPanelHostProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const panel = searchParams.get(MOVEMENT_PANEL.param);
  const requested = panel === MOVEMENT_PANEL.value;
  // Another panel (a new account) is asked for too: that one wins and this one stays out of the way.
  const accountPanelAsked = searchParams.has(NEW_ACCOUNT_PANEL.param);
  const open = requested && space !== undefined && !accountPanelAsked;

  // The movement the URL asks to edit: `?movimiento=editar&id=<uuid>`.
  const editing = panel === "editar";
  const editId = editing ? parseMovementEditId(searchParams) : undefined;
  const editOpen = editId !== undefined && space !== undefined && !accountPanelAsked;
  // Kept after it closes, while the sheet leaves; the sheet tells when it is gone (`onExited`).
  const [shownEditId, setShownEditId] = useState<string | undefined>();
  if (editOpen && shownEditId !== editId) setShownEditId(editId);

  // Derived during render, not in an effect: once opened it stays mounted.
  const [mounted, setMounted] = useState(false);
  if (open && !mounted) setMounted(true);

  const close = useCallback(() => closePanelInUrl(MOVEMENT_PANEL.param), []);
  const closeEdit = useCallback(
    () => closePanelInUrl(MOVEMENT_PANEL.param, ...MOVEMENT_PANEL_COMPANIONS),
    [],
  );
  const goToNewAccount = useCallback(
    () => replacePanelInUrl(MOVEMENT_PANEL.param, NEW_ACCOUNT_PANEL),
    [],
  );

  // An address that asks to edit with no movement, or with something that is not an id: nothing to
  // open, and the params would stay in the bar for good.
  useEffect(() => {
    if (editing && editId === undefined) closeEdit();
  }, [editing, editId, closeEdit]);

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

  if (!space) return null;
  return (
    <>
      {mounted ? (
        <MovementSheet
          open={open}
          space={space}
          api={api}
          onClose={close}
          onSaved={() => {
            close();
            router.refresh();
          }}
          onNoAccounts={goToNewAccount}
        />
      ) : null}
      {shownEditId ? (
        <MovementEditSheet
          // Another movement is a new sheet: nothing of the first one (its data, its form) is kept.
          key={shownEditId}
          open={editOpen && editId === shownEditId}
          space={space}
          movementId={shownEditId}
          api={api}
          onClose={closeEdit}
          onSaved={() => {
            closeEdit();
            router.refresh();
          }}
          onDeleted={closeEdit}
          onExited={() => setShownEditId(undefined)}
        />
      ) : null}
    </>
  );
}

"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  NEW_ACCOUNT_PANEL,
  SELECTED_ACCOUNT_PARAM,
  closePanelInUrl,
  openPanelInUrl,
  type AccountPanelView,
} from "@/components/accounts/panel-url";
import { DESKTOP_MEDIA_QUERY, useIsDesktop } from "@/components/use-is-desktop";
import type { Currency } from "@/lib/core/money";

// The panel (the sheet, the form, react-hook-form and zod) loads when it is asked for, not with
// every screen that has the shell.
const AccountPanelSheet = dynamic(() =>
  import("@/components/accounts/account-panel-sheet").then((module) => module.AccountPanelSheet),
);

const AccountEditPanel = dynamic(() =>
  import("@/components/accounts/account-edit-panel").then((module) => module.AccountEditPanel),
);

type AccountPanelHostProps = {
  /** The space the account is created in; without it (a screen that could not load it) nothing opens. */
  space?: { id: string; currency: Currency };
};

/**
 * Where the side panels of the accounts are shown (docs/diseno.md D17 › Escritorio v2, D18).
 * `AppShell` mounts it on every screen with a session, so a panel opens over whichever one the
 * person is on. The URL says which, and `useSearchParams` reads it:
 *
 * - `?cuenta=nueva` (the button of the sidebar, "Crear mi primera cuenta", the "+" and the one of
 *   Cuentas, via `PrimaryActionLink`): "Nueva cuenta".
 * - `?cuenta=editar` or `?cuenta=cuadrar` with `?sel=<id>` (the buttons of the detail of Cuentas, and
 *   the "Cuadrar saldo" and "Editar" inside the panel): "Editar cuenta" / "Cuadrar saldo" of that
 *   account, in one panel that switches views. Without `?sel` there is no account: the param is taken out.
 *
 * - From 1024 px the panel opens over the screen. Closing it takes `?cuenta` out of the URL (`?sel`
 *   stays: it is the chosen account of the list).
 * - Below 1024 px there are no panels: a new account is the page `/cuentas/nueva`; editing is
 *   `/cuentas/<id>`, and `?cuenta=cuadrar` opens the "Cuadrar saldo" sheet there. A URL with the
 *   param (a link shared from a desktop, a window narrowed) goes to that page.
 * - Each panel mounts the first time it is asked for and stays mounted (closed) afterwards, so it can
 *   play its exit animation; its form starts afresh every time it opens, because the sheet unmounts
 *   its content when closed.
 */
export function AccountPanelHost({ space }: AccountPanelHostProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const desktop = useIsDesktop();
  const param = searchParams.get(NEW_ACCOUNT_PANEL.param);
  const requested = param === NEW_ACCOUNT_PANEL.value;
  const open = requested && desktop && space !== undefined;

  const accountId = searchParams.get(SELECTED_ACCOUNT_PARAM);
  const view: AccountPanelView | null = param === "editar" || param === "cuadrar" ? param : null;
  const editOpen = view !== null && accountId !== null && desktop && space !== undefined;

  // Derived during render, not in an effect: once a panel has been open, it stays mounted. The
  // edit panel also remembers what it showed, so it keeps its content while it fades out.
  const [mounted, setMounted] = useState(false);
  if (open && !mounted) setMounted(true);
  const [shown, setShown] = useState<{ view: AccountPanelView; accountId: string } | null>(null);
  if (editOpen && (shown?.view !== view || shown.accountId !== accountId)) {
    setShown({ view, accountId });
  }

  useEffect(() => {
    // The width is asked here, not taken from `desktop`: while hydrating the hook says "phone" and
    // would send a desktop to the page.
    const wide = window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
    if (requested && !wide) router.replace("/cuentas/nueva");
    if (view === null) return;
    if (accountId === null) {
      closePanelInUrl(NEW_ACCOUNT_PANEL.param);
    } else if (!wide) {
      router.replace(`/cuentas/${accountId}${view === "cuadrar" ? "?cuenta=cuadrar" : ""}`);
    }
  }, [requested, view, accountId, desktop, router]);

  if (!space) return null;
  return (
    <>
      {mounted ? (
        <AccountPanelSheet
          open={open}
          space={space}
          onClose={() => closePanelInUrl(NEW_ACCOUNT_PANEL.param)}
        />
      ) : null}
      {shown ? (
        <AccountEditPanel
          open={editOpen}
          view={view ?? shown.view}
          space={space}
          accountId={shown.accountId}
          onView={(next) => openPanelInUrl({ param: NEW_ACCOUNT_PANEL.param, value: next })}
          onClose={() => closePanelInUrl(NEW_ACCOUNT_PANEL.param)}
        />
      ) : null}
    </>
  );
}

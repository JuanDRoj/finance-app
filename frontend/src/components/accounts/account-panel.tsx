"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { NEW_ACCOUNT_PANEL, closePanelInUrl } from "@/components/accounts/panel-url";
import { DESKTOP_MEDIA_QUERY, useIsDesktop } from "@/components/use-is-desktop";
import type { Currency } from "@/lib/core/money";

// The panel (the sheet, the form, react-hook-form and zod) loads when it is asked for, not with
// every screen that has the shell.
const AccountPanelSheet = dynamic(() =>
  import("@/components/accounts/account-panel-sheet").then((module) => module.AccountPanelSheet),
);

type AccountPanelHostProps = {
  /** The space the account is created in; without it (a screen that could not load it) nothing opens. */
  space?: { id: string; currency: Currency };
};

/**
 * Where the side panel "Nueva cuenta" is shown (docs/diseno.md D17 › Escritorio v2, D18). `AppShell`
 * mounts it on every screen with a session, so the panel opens over whichever one the person is on:
 * the button of the sidebar, "Crear mi primera cuenta" and the "+" put `?cuenta=nueva` in the URL
 * (`PrimaryActionLink`), and this reads it with `useSearchParams`.
 *
 * - From 1024 px: the panel opens over the screen. Closing it takes the param out of the URL.
 * - Below 1024 px there is no panel: the form is the page `/cuentas/nueva`, so a URL with the param
 *   (a link shared from a desktop, a window narrowed) goes there.
 * - The panel mounts the first time it is asked for and stays mounted (closed) afterwards, so it can
 *   play its exit animation; its form starts blank every time it opens, because the sheet unmounts
 *   its content when closed.
 */
export function AccountPanelHost({ space }: AccountPanelHostProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const desktop = useIsDesktop();
  const requested = searchParams.get(NEW_ACCOUNT_PANEL.param) === NEW_ACCOUNT_PANEL.value;
  const open = requested && desktop && space !== undefined;

  // Derived during render, not in an effect: once it has been open, the panel stays mounted.
  const [mounted, setMounted] = useState(false);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    // The width is asked here, not taken from `desktop`: while hydrating the hook says "phone" and
    // would send a desktop to the page.
    if (requested && !window.matchMedia(DESKTOP_MEDIA_QUERY).matches) {
      router.replace("/cuentas/nueva");
    }
  }, [requested, desktop, router]);

  if (!mounted || !space) return null;
  return (
    <AccountPanelSheet
      open={open}
      space={space}
      onClose={() => closePanelInUrl(NEW_ACCOUNT_PANEL.param)}
    />
  );
}

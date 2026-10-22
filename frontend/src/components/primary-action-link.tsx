"use client";

import Link from "next/link";
import type { ComponentProps, MouseEvent } from "react";
import { openPanelInUrl, type PanelRef } from "@/components/accounts/panel-url";
import { DESKTOP_MEDIA_QUERY } from "@/components/use-is-desktop";

type PrimaryActionLinkProps = Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & {
  /** Where it goes below 1024 px, with no JavaScript, or in a new tab: a page of its own. */
  href: string;
  /**
   * From 1024 px a click does not navigate: it opens this panel over the current screen
   * (`?param=value`, see `panel-url.ts`). Without it, this is a plain link.
   */
  panel?: PanelRef;
};

/**
 * The link of the main action ("Nueva cuenta", later "Registrar"): the button of the sidebar, the
 * "Crear mi primera cuenta" of the Inicio and, in the bottom bar, the "+". It is a real link to a
 * page (`href`), which is what a phone gets; from 1024 px (docs/diseno.md D17 › Escritorio v2) a
 * plain click opens the side panel instead, without leaving the screen. The width is asked at the
 * moment of the click (`matchMedia`), so nothing is rendered differently on the server and the
 * client, and a modified click (a new tab, a download) keeps its normal meaning.
 */
export function PrimaryActionLink({ href, panel, onClick, ...props }: PrimaryActionLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (!panel || event.defaultPrevented) return;
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (event.button !== 0 || modified) return;
    if (!window.matchMedia(DESKTOP_MEDIA_QUERY).matches) return;
    event.preventDefault();
    openPanelInUrl(panel);
  }

  // No prefetch: from 1024 px the page of the form is never visited, and the phone loads it at the tap.
  return <Link {...props} href={href} prefetch={false} onClick={handleClick} />;
}

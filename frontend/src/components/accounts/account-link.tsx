"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";
import { SELECTED_ACCOUNT_PARAM, openPanelInUrl } from "@/components/accounts/panel-url";
import { DESKTOP_MEDIA_QUERY } from "@/components/use-is-desktop";

type AccountLinkProps = Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & {
  accountId: string;
};

/**
 * The link to an account (docs/diseno.md D18): the rows of Cuentas and of "Tus cuentas" in the
 * Inicio. Its `href` is the account's page, `/cuentas/<id>` (its edit form, what a phone opens;
 * from 1024 px that page redirects to the list).
 *
 * From 1024 px a plain click does not leave the screen for it: on Cuentas it writes `?sel=<id>`
 * with `history.replaceState` (the detail changes, no request, no history entry); from anywhere
 * else (the Inicio) it goes to `/cuentas?sel=<id>` with the router. The width is asked at the moment
 * of the click (`matchMedia`), so server and client render the same, and a modified click (a new
 * tab) keeps its meaning. No prefetch: the page of an account is dynamic.
 */
export function AccountLink({ accountId, onClick, ...props }: AccountLinkProps) {
  const router = useRouter();
  const pathname = usePathname();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (event.button !== 0 || modified) return;
    if (!window.matchMedia(DESKTOP_MEDIA_QUERY).matches) return;
    event.preventDefault();
    if (pathname === "/cuentas") {
      openPanelInUrl({ param: SELECTED_ACCOUNT_PARAM, value: accountId });
    } else {
      router.push(`/cuentas?${SELECTED_ACCOUNT_PARAM}=${accountId}`);
    }
  }

  return <Link {...props} href={`/cuentas/${accountId}`} prefetch={false} onClick={handleClick} />;
}

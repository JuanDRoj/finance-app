"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { AccountIcon } from "@/components/accounts/account-icon";
import { SELECTED_ACCOUNT_PARAM, openPanelInUrl } from "@/components/accounts/panel-url";
import { focusRing } from "@/components/ui/focus";
import { DESKTOP_MEDIA_QUERY, useIsDesktop } from "@/components/use-is-desktop";
import { accountMetaLine, displayedAmount } from "@/lib/core/accounts-summary";
import type { AccountWithBalance } from "@/lib/core/data/accounts";
import { formatMoney, type Currency } from "@/lib/core/money";
import { cn } from "@/lib/utils";

type AccountRowProps = {
  account: AccountWithBalance;
  currency: Currency;
  /** The account the detail is showing (desktop). */
  selected: boolean;
};

/**
 * A row of the list of Cuentas (docs/diseno.md D18): the icon of its type, the name (cut with "…",
 * the whole name in `title`), its line (the type, or "Cierra el 5 · vence el 12") and its amount
 * with `formatMoney`, a card by what it owes (positive, in the debt color).
 *
 * - From 1024 px it is a link to `/cuentas?sel=<id>` (`aria-current` on the chosen one): a plain
 *   click does not navigate, it writes `?sel` with `history.replaceState` (no request, no history
 *   entry), which the screen reads to fill the detail. A modified click keeps its meaning.
 * - Below 1024 px it is **not interactive yet**: the page of an account (its edit form) is KAN-92
 *   (FE-28), and a link to it would be a 404. The row is plain text until then. Like the rest of
 *   what depends on the width, the server and the first client render show the phone version.
 */
export function AccountRow({ account, currency, selected }: AccountRowProps) {
  const desktop = useIsDesktop();
  const isCard = account.type === "credit_card";

  const content = (
    <>
      <AccountIcon type={account.type} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-item font-bold" title={account.name}>
          {account.name}
        </span>
        <span className="truncate text-caption text-muted-foreground">
          {accountMetaLine(account)}
        </span>
      </span>
      <span
        className={cn(
          "min-w-0 max-w-[60%] text-right font-heading text-item font-semibold break-all tabular-nums",
          isCard && "text-debt",
        )}
      >
        {formatMoney(displayedAmount(account), currency)}
      </span>
    </>
  );
  const classes = "flex min-h-17 items-center gap-3 px-3.5 lg:min-h-13.5 lg:rounded-xl lg:px-2";

  if (!desktop) return <div className={classes}>{content}</div>;

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (event.button !== 0 || modified || event.defaultPrevented) return;
    // Asked at the moment of the click, like `PrimaryActionLink`: the width may have changed.
    if (!window.matchMedia(DESKTOP_MEDIA_QUERY).matches) return;
    event.preventDefault();
    openPanelInUrl({ param: SELECTED_ACCOUNT_PARAM, value: account.id });
  }

  return (
    <Link
      href={`/cuentas?${SELECTED_ACCOUNT_PARAM}=${account.id}`}
      prefetch={false}
      aria-current={selected ? "true" : undefined}
      onClick={handleClick}
      className={cn(
        classes,
        // The chosen row is `primary` at 10 % (12 % in dark), as K-V2 draws it, plus an inset ring so
        // it does not rely on the tint alone; hover is the subtler `accent`, so hovering another
        // row never hides which one is chosen.
        selected
          ? "bg-primary/10 ring-1 ring-primary/40 ring-inset dark:bg-primary/12"
          : "hover:bg-accent",
        focusRing,
      )}
    >
      {content}
    </Link>
  );
}

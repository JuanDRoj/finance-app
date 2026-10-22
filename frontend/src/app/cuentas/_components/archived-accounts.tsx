"use client";

import { CaretDown } from "@phosphor-icons/react/ssr";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { focusRing } from "@/components/ui/focus";
import { browserApi } from "@/lib/api/browser";
import { accountMetaLine, displayedAmount } from "@/lib/core/accounts-summary";
import type { ApiClient } from "@/lib/core/data/api-client";
import { unarchiveAccount, type AccountWithBalance } from "@/lib/core/data/accounts";
import { isUnauthorized } from "@/lib/core/data/errors";
import { spaceQueryKey } from "@/lib/core/data/spaces";
import { NETWORK_ERROR, describeApiError } from "@/lib/core/i18n";
import { formatMoney, type Currency } from "@/lib/core/money";
import { cn } from "@/lib/utils";

type ArchivedAccountsProps = {
  accounts: readonly AccountWithBalance[];
  space: { id: string; currency: Currency };
  api?: ApiClient;
};

/**
 * "Archivadas (n)" (docs/diseno.md D18): a folded section at the end of Cuentas; opened, each
 * archived account in `muted-foreground` with its type, its balance and "Desarchivar". Unarchiving
 * has no confirmation: the row leaves this list, the account joins its group, the queries of the
 * space are invalidated, the server data refreshed (the neto of the header, the sidebar and the
 * Inicio) and a toast says "Desarchivaste «…»" (without "Deshacer": archiving again is FE-28's).
 */
export function ArchivedAccounts({ accounts, space, api = browserApi }: ArchivedAccountsProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const router = useRouter();
  const queryClient = useQueryClient();

  const unarchive = useMutation({
    mutationFn: (account: AccountWithBalance) => unarchiveAccount(api, space.id, account.id),
    onSuccess: async (account) => {
      toast.success(`Desarchivaste «${account.name}»`);
      await queryClient.invalidateQueries({ queryKey: spaceQueryKey(space.id) });
      router.refresh();
    },
    onError: (error) => {
      if (isUnauthorized(error)) {
        window.location.replace("/login");
        return;
      }
      const { title, message } = describeApiError(error);
      toast.error(title, { description: message });
    },
  });

  if (accounts.length === 0) return null;
  const busyId = unarchive.isPending ? unarchive.variables?.id : undefined;

  return (
    <section
      aria-label="Cuentas archivadas"
      className="tile-surface flex min-w-0 flex-col rounded-tile lg:rounded-card lg:border-dashed lg:border-input lg:bg-transparent"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex min-h-13 items-center justify-between gap-3 rounded-[inherit] px-4 text-left text-item font-bold lg:min-h-11.5 lg:text-muted-foreground",
          focusRing,
        )}
      >
        Archivadas ({accounts.length})
        <CaretDown
          aria-hidden
          weight="bold"
          className={cn(
            "size-4 shrink-0 transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
      <ul id={panelId} hidden={!open} className="flex flex-col">
        {accounts.map((account) => (
          <li
            key={account.id}
            className="flex min-h-16 items-center gap-3 border-t border-border px-4 py-2 lg:min-h-13"
          >
            <span className="flex min-w-0 flex-1 flex-col text-muted-foreground">
              <span className="truncate text-item font-bold" title={account.name}>
                {account.name}
              </span>
              <span className="truncate text-caption">{accountMetaLine(account)}</span>
              {/* A balance is never cut: it wraps instead (only the name and the type are truncated). */}
              <span className="text-caption break-all tabular-nums">
                {formatMoney(displayedAmount(account), space.currency)}
              </span>
            </span>
            <Button
              variant="outline"
              size="sm"
              className="lg:min-h-9 lg:px-3.5 lg:pointer-coarse:min-h-11"
              loading={busyId === account.id}
              disabled={unarchive.isPending}
              aria-label={`Desarchivar ${account.name}`}
              onClick={() => unarchive.mutate(account)}
            >
              Desarchivar
            </Button>
          </li>
        ))}
      </ul>
      {unarchive.isPaused ? (
        <p role="status" className="px-4 pb-3 text-caption text-muted-foreground">
          {NETWORK_ERROR.title}. {NETWORK_ERROR.message}
        </p>
      ) : null}
    </section>
  );
}

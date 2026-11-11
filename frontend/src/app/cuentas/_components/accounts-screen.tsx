"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { SELECTED_ACCOUNT_PARAM } from "@/components/accounts/panel-url";
import { browserApi } from "@/lib/api/browser";
import {
  groupAccounts,
  selectedAccount,
  splitArchived,
  summarizeAccounts,
} from "@/lib/core/accounts-summary";
import type { ApiClient } from "@/lib/core/data/api-client";
import { accountsQueryOptions } from "@/lib/core/data/accounts";
import type { Currency } from "@/lib/core/money";
import { AccountDetail } from "./account-detail";
import { AccountGroup } from "./account-group";
import { AccountsEmpty } from "./accounts-empty";
import { AccountsError } from "./accounts-error";
import { AccountsSkeleton } from "./accounts-skeleton";
import { ArchivedAccounts } from "./archived-accounts";

type AccountsScreenProps = {
  space: { id: string; currency: Currency };
  /** The current month (`YYYY-MM`) and day of the space's zone, computed by the server page. */
  currentMonth: string;
  today: string;
  /** The API client; the browser's by default (the catalog and the tests pass a scripted one). */
  api?: ApiClient;
};

/**
 * The body of Cuentas (docs/diseno.md D18): the list grouped in Disponible and Deuda with their
 * totals, "Archivadas (n)" at the end and, from 1024 px, the detail of the chosen account on the
 * right. The data come from one query with the archived accounts included (the server prefetched
 * it and the page hydrates it); active and archived are told apart here.
 *
 * - Loading: a skeleton of a group of three rows. Error: "No se pudieron cargar tus cuentas" with
 *   "Reintentar"; a failed load is never taken for "no accounts".
 * - Empty: no active account (none at all, or only archived ones; those stay below so they can be
 *   unarchived).
 * - The detail's account is derived while rendering from `?sel`: none, an archived one or an id
 *   that does not exist give the first active account (`selectedAccount`).
 * - From 1024 px the two are a wrapping row, as the canvas draws it (`flex-wrap`): the list wants
 *   320 px (and grows to 400 at most) and the detail wants 480 px and takes all the rest, `min-w-0`
 *   so a long name or a huge amount cannot push it out. With the table of movements inside, the
 *   detail needs that room: below about 1124 px of window (a content column of 820 px) it does not
 *   fit beside the list and goes under it, at the full width, instead of squeezing the table.
 * - The detail is remounted for each account (`key`), and it asks for its movements only from 1024 px
 *   (`currentMonth` and `today` are the space's, from the server page).
 */
export function AccountsScreen({
  space,
  currentMonth,
  today,
  api = browserApi,
}: AccountsScreenProps) {
  const searchParams = useSearchParams();
  const query = useQuery(accountsQueryOptions(api, space.id, { includeArchived: true }));
  const sel = searchParams.get(SELECTED_ACCOUNT_PARAM);

  const derived = useMemo(() => {
    if (!query.data) return undefined;
    const { active, archived } = splitArchived(query.data);
    return {
      archived,
      active,
      totals: summarizeAccounts(active),
      groups: groupAccounts(active),
      selected: selectedAccount(active, sel),
    };
  }, [query.data, sel]);

  if (!derived) {
    if (query.isError) {
      return <AccountsError onRetry={() => void query.refetch()} busy={query.isFetching} />;
    }
    return <AccountsSkeleton />;
  }

  const { active, archived, totals, groups, selected } = derived;
  const archivedSection = <ArchivedAccounts accounts={archived} space={space} api={api} />;

  if (active.length === 0) {
    return (
      <div className="flex flex-col gap-4 lg:max-w-140">
        <AccountsEmpty />
        {archivedSection}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-start lg:gap-5">
      <div className="flex min-w-0 flex-col gap-4 lg:max-w-100 lg:shrink lg:grow lg:basis-80">
        {groups.available.length > 0 ? (
          <AccountGroup
            title="Disponible"
            total={totals.available}
            accounts={groups.available}
            currency={space.currency}
            selectedId={selected?.id}
          />
        ) : null}
        {groups.cards.length > 0 ? (
          <AccountGroup
            title="Deuda"
            total={totals.debt}
            debt
            accounts={groups.cards}
            currency={space.currency}
            selectedId={selected?.id}
          />
        ) : null}
        {archivedSection}
      </div>
      {selected ? (
        <div className="hidden min-w-0 lg:block lg:shrink lg:grow-999 lg:basis-120">
          <AccountDetail
            key={selected.id}
            account={selected}
            space={space}
            currentMonth={currentMonth}
            today={today}
            api={api}
          />
        </div>
      ) : null}
    </div>
  );
}

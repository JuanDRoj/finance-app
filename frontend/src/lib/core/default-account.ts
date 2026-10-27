import type { AccountWithBalance } from "./data/accounts";

/**
 * The account a new movement starts on (docs/diseno.md D19: "la última usada o la primera"): the
 * one the person used last if it is still an active account of the space, otherwise the first
 * active one, in the order of the list (the API sends them by name). `""` when there is no active
 * account at all, which is the form's cue to send the person to "Nueva cuenta". An archived account
 * is never offered, nor is an id that is not in the list (another space's, or an account deleted
 * elsewhere), so what is stored can only ever help.
 */
export function pickDefaultAccountId(
  accounts: readonly Pick<AccountWithBalance, "id" | "archived_at">[],
  lastUsedId: string | null | undefined,
): string {
  const active = accounts.filter((account) => account.archived_at === null);
  if (lastUsedId && active.some((account) => account.id === lastUsedId)) return lastUsedId;
  return active[0]?.id ?? "";
}

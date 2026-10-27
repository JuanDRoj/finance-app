/**
 * The account a person used last, per space, so "Registrar movimiento" starts on it (docs/diseno.md
 * D19: "la última usada o la primera"). It lives in the browser's `localStorage` and nowhere else:
 * the backend has no such field, and it is a convenience, not data (losing it means the form starts
 * on the first account). That is why it is outside `lib/core`, which stays free of the browser; the
 * rule that uses it, `pickDefaultAccountId`, is in core.
 *
 * - The key is versioned and per space (`kanza:lastAccount:v1:<spaceId>`) and holds only the id of
 *   the account: nothing else of the account, and nothing secret. A new shape means a new version.
 * - Every access is in a `try`: `localStorage` throws in private modes, when storage is disabled or
 *   full, and on some embedded browsers. Failing to read is "nothing stored"; failing to write is
 *   silently ignored.
 * - What is read is not trusted: `pickDefaultAccountId` only takes it if it is an active account of
 *   the space, so a stale or foreign id (another user on the same browser) can do no harm. It is
 *   not cleared on logout for that reason.
 */

const KEY_PREFIX = "kanza:lastAccount:v1:";

const keyOf = (spaceId: string) => `${KEY_PREFIX}${spaceId}`;

/** The id of the account used last in this space, or `null` if none is stored or storage is not available. */
export function readLastAccountId(spaceId: string): string | null {
  if (!spaceId) return null;
  try {
    const value = globalThis.localStorage.getItem(keyOf(spaceId));
    return value ? value : null;
  } catch {
    return null;
  }
}

/** Remembers the account used last in this space. Call it only once a movement was registered. */
export function saveLastAccountId(spaceId: string, accountId: string): void {
  if (!spaceId || !accountId) return;
  try {
    globalThis.localStorage.setItem(keyOf(spaceId), accountId);
  } catch {
    // Storage is off or full: the form starts on the first account next time. Nothing to tell the person.
  }
}

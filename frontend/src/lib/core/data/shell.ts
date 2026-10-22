import type { ApiClient } from "./api-client";
import { isUnauthorized } from "./errors";
import { getMe, type UserRead } from "./me";
import { listSpaces, type SpaceRead } from "./spaces";

/** What every screen with the shell needs: the user (avatar) and the spaces (sidebar). */
export type ShellData =
  { ok: true; user: UserRead; spaces: SpaceRead[] } | { ok: false; error: unknown };

/**
 * `GET /me` and `GET /spaces`, together. Both are independent, so they run in parallel, and both
 * are awaited to the end (`allSettled`), so the outcome does not depend on which one fails first.
 * The failure is returned, not thrown, so that a page can call `redirect()` (which works by
 * throwing) outside a `try`. A 401 from either call wins over any other failure of the other one
 * (the session is gone, and `/login` is the answer); without a 401, the first failure is the one
 * reported, `/me` before `/spaces`.
 */
export async function loadShellData(api: ApiClient): Promise<ShellData> {
  const [me, spaces] = await Promise.allSettled([getMe(api), listSpaces(api)]);

  if (me.status === "fulfilled" && spaces.status === "fulfilled") {
    return { ok: true, user: me.value, spaces: spaces.value };
  }

  const failures: unknown[] = [];
  if (me.status === "rejected") failures.push(me.reason);
  if (spaces.status === "rejected") failures.push(spaces.reason);
  return { ok: false, error: failures.find(isUnauthorized) ?? failures[0] };
}

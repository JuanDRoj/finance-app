/**
 * Picks one cookie out of a raw `Cookie` request header and returns it as `name=value`, with the
 * value exactly as the browser sent it. Nothing is decoded or encoded: that is why this reads the
 * header text instead of `cookies()` from `next/headers`, which re-encodes values.
 *
 * - The name must match exactly (case-sensitive): `session` is not `session2`, `x-session` or
 *   `__Host-session`.
 * - With the same name twice, the first one wins (browsers list the most specific path first).
 * - `null` when the header is missing, the cookie is not in it, or its value is empty.
 *
 * Pure on purpose (no `server-only`, no Next): `getServerApi()` uses it and it is tested in Node.
 */
export function pickCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;

  for (const part of header.split(";")) {
    const pair = part.trim();
    const equals = pair.indexOf("=");
    if (equals === -1 || pair.slice(0, equals) !== name) continue;
    return pair.length > equals + 1 ? pair : null;
  }

  return null;
}

import type { UserRead } from "./data/me";

/**
 * The name to show for a user: their `display_name`; without one, the part of the email before
 * the last `@` (docs/decisiones-producto.md: it is never stored). An email with no `@`, or with
 * nothing before it, is shown whole.
 */
export function displayNameOf(user: Pick<UserRead, "display_name" | "email">): string {
  const name = user.display_name?.trim();
  if (name) return name;

  const email = user.email.trim();
  const at = email.lastIndexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

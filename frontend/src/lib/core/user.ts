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

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * The letter for the avatar: the first letter or digit of `displayNameOf(user)`, upper case in
 * Spanish. `null` when the name has none (for example `@example.com`, or only symbols): the
 * avatar then shows a generic person icon instead of an odd character. It goes through
 * `Array.from`, so a letter outside the BMP is kept whole.
 */
export function initialOf(user: Pick<UserRead, "display_name" | "email">): string | null {
  const first = Array.from(displayNameOf(user)).find((character) =>
    LETTER_OR_DIGIT.test(character),
  );
  return first === undefined ? null : first.toLocaleUpperCase("es");
}
